import type { RequestHandler } from "express";
import {
  TRACE_ID_HEADER,
  resolveTraceId,
  sanitizeAddress,
  TRACEPARENT_HEADER,
  runWithRequestContext,
  createLogger,
} from "@lib/core/logging";

const traceLogger = createLogger("trace-middleware");

function sessionIdFrom(pathname: string): Record<string, string> {
  const match = /\/sessions\/([A-Za-z0-9_-]{1,128})(?:\/|$)/.exec(pathname);
  return match ? { session_id: match[1]! } : {};
}

export const traceMiddleware: RequestHandler = (req, res, next) => {
  const resolved = resolveTraceId(
    req.get(TRACE_ID_HEADER) ?? null,
    req.get(TRACEPARENT_HEADER) ?? null,
  );
  res.setHeader(TRACE_ID_HEADER, resolved.traceId);
  const clientAddress =
    sanitizeAddress(req.get("x-forwarded-for")?.split(",")[0]) ||
    sanitizeAddress(req.get("x-real-ip"));
  const peerAddress = sanitizeAddress(req.socket?.remoteAddress);
  const startedAt = process.hrtime.bigint();
  const context = { traceId: resolved.traceId, clientAddress, peerAddress };
  runWithRequestContext(context, () => {
    if (resolved.clientTraceId) {
      traceLogger.warn(
        `入站 X-Trace-Id 不合规，已另生成；原值 client_trace_id=${resolved.clientTraceId}`,
        {
          event: "trace.client_id_rejected",
          client_trace_id: resolved.clientTraceId,
        },
      );
    }
    let recorded = false;
    const record = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const status = res.statusCode;
      const level = status >= 500 ? "warn" : "info";
      runWithRequestContext(context, () =>
        traceLogger[level](`${req.method} ${req.path} ${status}`, {
          event: "http.request",
          http_request_method: req.method,
          url_path: req.path,
          ...sessionIdFrom(req.path),
          http_response_status_code: status,
          duration_ms: Math.round(durationMs),
          user_agent_original: req.get("user-agent") ?? "",
          ...(aborted ? { http_client_aborted: 1 } : {}),
        }),
      );
    };
    res.once("finish", () => record(false));
    res.once("close", () => record(!res.writableEnded));
    next();
  });
};
