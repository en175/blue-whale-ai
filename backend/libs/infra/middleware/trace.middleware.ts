/**
 * 入站 X-Trace-Id 与请求上下文中间件（IK9RSS；地址与访问日志 IKB29O）。
 *
 * 从请求头取 x-trace-id（透传优先），无则生成，用 runWithRequestContext 包住整个下游请求处理链，
 * 使 getCurrentTraceId() 在 handler/service 中可用。同一个上下文里还带上调用方地址——
 * 工单要求「错误场景能看到是哪个 IP 出的问题」，而地址只在请求这一层存在：进程级字段
 * （service_name / service_instance_id / host_ip）回答不了「谁发起的」。
 *
 * 设计要点：
 * - Express RequestHandler（非 NestMiddleware）：两个 app 的 main.ts 都通过
 *   app.use() 注册，避免引入 NestMiddleware 的 module consumer 配置开销。
 * - runWithRequestContext(ctx, next) 的 ALS 上下文在 Express next→route handler 同步调用链内
 *   传播；NestJS handler 在 next 的同步栈内执行，getCurrentTraceId() 可用。
 */
import type { RequestHandler } from "express";
import {
  TRACE_ID_HEADER,
  resolveTraceId,
  sanitizeAddress,
  TRACEPARENT_HEADER,
  runWithRequestContext,
  createLogger,
} from "@blue-whale/core/logging";

const traceLogger = createLogger("trace-middleware");

export const traceMiddleware: RequestHandler = (req, res, next) => {
  const resolved = resolveTraceId(
    req.get(TRACE_ID_HEADER) ?? null,
    req.get(TRACEPARENT_HEADER) ?? null,
  );
  // 回给客户端（IKB29O）。New API 早就这么做（middleware/request-id.go），我们没有——
  // 于是用户在浏览器里看不到 trace_id，报障时报不出任何能定位的东西，只能说"刚才那次"。
  res.setHeader(TRACE_ID_HEADER, resolved.traceId);
  // X-Forwarded-For 是客户端可控的列表：只取首项，且必须是地址字面量才写进去。socket 对端
  // 另记一份，伪造的 XFF 只能添一个声称，抹不掉连接的事实。
  const clientAddress =
    sanitizeAddress(req.get("x-forwarded-for")?.split(",")[0]) ||
    sanitizeAddress(req.get("x-real-ip"));
  const peerAddress = sanitizeAddress(req.socket?.remoteAddress);
  const startedAt = process.hrtime.bigint();
  const context = { traceId: resolved.traceId, clientAddress, peerAddress };
  runWithRequestContext(context, () => {
    // 写在上下文里面，这一行才带得上新生成的 trace_id——写在外面就是一条查不到的
    // 孤儿告警。被拒的入站值只说一次，就在入口：它是调用方的 bug，在这个请求写的每一行里
    // 重复它只会把请求自己的故事埋掉。
    if (resolved.clientTraceId) {
      traceLogger.warn(
        `入站 X-Trace-Id 不合规，已另生成；原值 client_trace_id=${resolved.clientTraceId}`,
        {
          event: "trace.client_id_rejected",
          client_trace_id: resolved.clientTraceId,
        },
      );
    }
    // 每个请求一行访问日志（IKB29O）。此前这个服务一行都没有：请求进来、走哪条路由、
    // 什么状态、多久，全无记录，于是一次在路由之前就失败的请求连"到达过"都证明不了。
    // 挂在 finish 上而不是 close：finish 是响应写完，close 还包括客户端提前断开——
    // 两者都要记，所以下面用 once 各挂一次，先到的那个赢。
    let recorded = false;
    const record = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const status = res.statusCode;
      const level = status >= 500 ? "warn" : "info";
      // 显式重入上下文。EventEmitter 的监听器**不**继承注册时的 ALS 存储——它在 emit 那一侧的
      // 上下文里跑，而 finish 由 Node 在这个中间件早已返回之后触发。不重入的话，
      // 这一行的 trace_id 与地址全是空的，也就是整条链上唯一一行必然带得上它们的日志反而没有。
      runWithRequestContext(context, () =>
        traceLogger[level](`${req.method} ${req.path} ${status}`, {
          event: "http.request",
          http_request_method: req.method,
          url_path: req.path,
          http_response_status_code: status,
          duration_ms: Math.round(durationMs),
          user_agent_original: req.get("user-agent") ?? "",
          // SSE 与大文件上传下经常是客户端先走。分开记，否则它看起来像一次正常完成的请求。
          ...(aborted ? { http_client_aborted: 1 } : {}),
        }),
      );
    };
    res.once("finish", () => record(false));
    res.once("close", () => record(!res.writableEnded));
    next();
  });
};
