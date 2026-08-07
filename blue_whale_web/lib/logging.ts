/**
 * web/BFF 统一日志与链路上下文（IK73EV，父任务 IK6KO2）。
 *
 * - getBffLogger：结构化 JSON 日志（复用 @blue-whale/core/logging），
 *   输出 console + 异步上报火山 TLS（配置不全自动 no-op）。
 * - requestTraceId：从当前请求读取入站 X-Trace-Id（透传优先），
 *   无入站头时回落链路上下文，仍无则缺省生成。
 * - createWebNewApiClient：BFF 出站 new-api client 工厂，自动把
 *   入站 trace id 透传到出站 X-Trace-Id。
 *
 * 注意：requestTraceId 只取 id、不写入 AsyncLocalStorage——handler 内若直接用
 * getBffLogger() 记日志，trace_id 为空串，需自行包
 * runWithTraceId(await requestTraceId(), ...) 建立链路上下文；
 * 后台任务（请求上下文之外）同理需先包 runWithTraceId。
 *
 * 零业务侵入：route handlers 业务逻辑不改，仅替换 client 创建点。
 */
import {
  createNewApiClient,
  getCurrentTraceId,
  getOrCreateTraceId,
  type NewApiClientOptions,
} from "@blue-whale/core";
import { createLogger, type Logger } from "@blue-whale/core/logging";
import { headers } from "next/headers";

let cachedLogger: Logger | null = null;

/** web 进程级结构化 logger（container 缺省 blue-whale-web / CONTAINER_NAME）。 */
export function getBffLogger(): Logger {
  if (!cachedLogger) cachedLogger = createLogger("blue-whale-web");
  return cachedLogger;
}

/**
 * 当前请求入站 trace id：入站 X-Trace-Id 透传优先；
 * 无入站头时回落到链路上下文（后台任务），仍无则缺省生成；
 * 非请求上下文（headers() 不可用）时同样回落/生成兜底。
 *
 * 边界：请求上下文之外且无链路上下文时，每次调用会生成新 id——
 * 后台任务内多次出站调用需先包 runWithTraceId 保证 trace 一致。
 */
export async function requestTraceId(): Promise<string> {
  let inbound: string | null = null;
  try {
    const headerMap = await headers();
    inbound = headerMap.get("x-trace-id");
  } catch {
    // 非请求上下文（后台扫描等）：忽略，走回落逻辑。
  }
  if (inbound !== null && inbound.trim() !== "") return getOrCreateTraceId(inbound);
  return getCurrentTraceId() ?? getOrCreateTraceId(inbound);
}

/** BFF 出站 new-api client：出站 X-Trace-Id 与入站一致（IK73EV）。 */
export function createWebNewApiClient(options: NewApiClientOptions) {
  return createNewApiClient({
    ...options,
    traceIdProvider: () => requestTraceId(),
  });
}
