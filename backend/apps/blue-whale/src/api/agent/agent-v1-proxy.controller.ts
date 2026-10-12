import { Readable } from "node:stream";
import {
  All,
  Controller,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  TRACE_ID_HEADER,
  generateTraceId,
  getCurrentTraceId,
} from "@lib/core/logging";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { agentServiceBaseUrl, agentServiceToken, agentTenantId } from "@lib/shared/agent/agent-service-env.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 60_000;
const DEFAULT_BODY_TIMEOUT_MS = 60_000;

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function connectTimeoutMs(): number {
  return positiveInt(process.env.AGENT_UPSTREAM_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS);
}
function bodyTimeoutMs(): number {
  return positiveInt(process.env.AGENT_UPSTREAM_BODY_TIMEOUT_MS, DEFAULT_BODY_TIMEOUT_MS);
}

function timeoutError(message: string): DOMException {
  return new DOMException(message, "TimeoutError");
}

@Controller("agent/v1")
export class AgentV1ProxyController {
  constructor(private readonly project: ProjectService) {}

  @All("*path")
  async proxy(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const route = req.originalUrl.match(/^\/api\/agent\/v1\/projects\/([^/]+)(\/.*)?$/);
    if (!route) {
      res.status(404).json({ code: 404, msg: "Agent route not found", data: null });
      return;
    }
    const projectId = decodeURIComponent(route[1]!);

    const owned = await this.project.findOwnedById(projectId, user.userId);
    if (!owned) {
      res.status(403).json({ code: 403, msg: "Project not accessible", data: null });
      return;
    }

    const base = agentServiceBaseUrl();
    const upstreamUrl = `${base}${req.originalUrl.replace(/^\/api\/agent/, "")}`;

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value || key === "authorization") continue;
      // 请求体下面按 req.body 重新序列化，长度跟原请求不一定一样：照抄原长度，agent 会按旧长度收不满而报错
      if (key === "content-length" || key === "transfer-encoding") continue;
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    headers.authorization = `Bearer ${agentServiceToken()}`;
    headers["x-blue-whale-tenant-id"] = agentTenantId();
    headers["x-blue-whale-user-id"] = user.userId;
    headers["x-blue-whale-project-id"] = projectId;
    headers[TRACE_ID_HEADER] =
      getCurrentTraceId() ?? headers[TRACE_ID_HEADER] ?? generateTraceId();

    const rawBody =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : Buffer.from(req.body === undefined || req.body === null ? "" : JSON.stringify(req.body));

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    let deadline: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort.abort(timeoutError("upstream connect timeout")),
      connectTimeoutMs(),
    );

    let upstream: globalThis.Response;
    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        signal: abort.signal,
      };
      if (!["GET", "HEAD"].includes(req.method) && rawBody !== undefined) {
        init.body = rawBody;
      }
      upstream = await fetch(upstreamUrl, init);
    } catch (error) {
      clearTimeout(deadline);
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "上游 agent 服务响应超时"
          : `上游 agent 服务不可用（${base}）`;
      if (!res.headersSent) {
        res.status(502).json({ code: 502, msg: message, data: null });
      }
      return;
    }
    clearTimeout(deadline);
    deadline = undefined;

    const isEventStream = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
    if (!isEventStream) {
      deadline = setTimeout(() => abort.abort(timeoutError("upstream body timeout")), bodyTimeoutMs());
    }

    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      const name = key.toLowerCase();
      if (name !== "content-length" && name !== "content-encoding") {
        res.set(key, value);
      }
    }

    if (isEventStream) {
      res.setHeader("cache-control", "no-cache, no-transform");
      res.setHeader("x-accel-buffering", "no");
      res.socket?.setNoDelay(true);
      res.flushHeaders();
    }

    if (!upstream.body) {
      clearTimeout(deadline);
      res.end();
      return;
    }

    const stream = Readable.fromWeb(
      upstream.body as import("node:stream/web").ReadableStream,
    );
    stream.on("error", (error) => {
      clearTimeout(deadline);
      logger.error(
        `[agent/v1] upstream stream error: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!res.writableEnded) res.end();
    });
    stream.on("end", () => clearTimeout(deadline));
    stream.pipe(res);
  }
}
