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
  getOrCreateTraceId,
  runWithTraceId,
} from "@blue-whale/core/logging";

export const traceMiddleware: RequestHandler = (req, _res, next) => {
  const headerValue = req.get(TRACE_ID_HEADER) ?? null;
  const traceId = getOrCreateTraceId(headerValue);
  runWithTraceId(traceId, next);
};
