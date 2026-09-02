/**
 * 入站 X-Trace-Id 中间件（IK9RSS）。
 *
 * 从请求头取 x-trace-id（透传优先），无则生成，用 runWithTraceId 包住
 * 整个下游请求处理链，使 getCurrentTraceId() 在 handler/service 中可用。
 *
 * 设计要点：
 * - Express RequestHandler（非 NestMiddleware）：两个 app 的 main.ts 都通过
 *   app.use() 注册，避免引入 NestMiddleware 的 module consumer 配置开销。
 * - runWithTraceId(id, next) 的 ALS 上下文在 Express next→route handler 同步调用链内
 *   传播；NestJS handler 在 next 的同步栈内执行，getCurrentTraceId() 可用。
 */
import type { RequestHandler } from "express";
import {
  TRACE_ID_HEADER,
  resolveTraceId,
  TRACEPARENT_HEADER,
  runWithTraceId,
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
  runWithTraceId(resolved.traceId, () => {
    // 写在 runWithTraceId 里面，这一行才带得上新生成的 trace_id——写在外面就是一条查不到的
    // 孤儿告警。被拒的入站值只说一次，就在入口：它是调用方的 bug，在这个请求写的每一行里
    // 重复它只会把请求自己的故事埋掉。
    if (resolved.clientTraceId) {
      traceLogger.warn(
        `入站 X-Trace-Id 不合规，已另生成；原值 client_trace_id=${resolved.clientTraceId}`,
      );
    }
    next();
  });
};
