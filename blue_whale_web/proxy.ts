/**
 * BFF 入口链路与访问日志（IK73EV，父任务 IK6KO2；Next 16 约定 proxy.ts）。
 *
 * - X-Trace-Id 透传优先、缺省生成：注入下游请求头（route handler 读取），
 *   并回传响应头（浏览器/排查侧可见）。
 * - BFF 访问日志：结构化 JSON（含 trace_id）输出 + 异步上报火山 TLS。
 *
 * 注意：middleware 在独立执行上下文运行，只能通过 header 传递 trace id；
 * route handler 侧由 lib/logging.ts 的 requestTraceId / createWebNewApiClient
 * 读取并带入出站请求。
 *
 * 边界：matcher 仅覆盖 /api/:path*（BFF 接口）。SSR 页面请求不经过本中间件，
 * 目前无页面侧出站 new-api 调用（全部调用点均在 /api 下）；未来 SSR 侧接入
 * 链路追踪时需同步扩展 matcher 或另行注入。
 */
import {
  TRACE_ID_HEADER,
  closeDefaultTlsLogWriter,
  createLogger,
  getOrCreateTraceId,
  runWithTraceId,
} from "@blue-whale/core/logging";
import { NextResponse, type NextRequest } from "next/server";

const logger = createLogger("blue-whale-web");

// proxy bundle 独立持有自己的 TLS Producer 实例（与 server bundle 不共享），
// 在此注册优雅关闭，避免进程退出时高频访问日志通道丢缓冲（IK73EV）。
// close 幂等 + exit 短路，与 instrumentation 侧 listener 互不干扰。
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void closeDefaultTlsLogWriter().finally(() => process.exit(0));
  });
}

export function proxy(request: NextRequest): NextResponse {
  // 透传优先：入站已带 X-Trace-Id 原样沿用，否则缺省生成（同一链路不重生成）。
  const traceId = getOrCreateTraceId(request.headers.get(TRACE_ID_HEADER));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TRACE_ID_HEADER, traceId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(TRACE_ID_HEADER, traceId);

  runWithTraceId(traceId, () => {
    logger.info(
      `inbound ${request.method} ${request.nextUrl.pathname}`,
    );
  });
  return response;
}

// proxy 恒运行于 Node.js runtime（Next 16 约定），无需也不能声明 runtime 字段。
export const config = {
  matcher: ["/api/:path*"],
};
