import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import {
  All,
  Controller,
  Headers,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";

/** NewAPI 上游（OpenAI 兼容 /v1）。空值时本控制器对每个请求返回 503。 */
const NEW_API_BASE_URL = process.env.NEW_API_BASE_URL?.trim() || "";
/** 非流式请求超时；流式（body.stream === true）不设超时，交给上游自然结束或客户端断开。 */
const UPSTREAM_TIMEOUT_MS = 60_000;
/** 本控制器挂载的路由前缀（含全局 /api）。NewAPI 只认裸 `/v1/...`，转发前必须去掉这段。 */
const ROUTE_PREFIX = "/api/internal/agent-model";

function authorizedAgentService(header: string | undefined): boolean {
  const expected = process.env.AGENT_SERVICE_TOKEN?.trim();
  if (!expected || !header) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(header);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function isStreamingRequest(rawBody: Buffer): boolean {
  if (rawBody.length === 0) return false;
  try {
    const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).stream === true
    );
  } catch {
    return false;
  }
}

/**
 * `/api/internal/agent-model/*` —— 独立 blue-whale-agent 服务到 NewAPI 的计费网关代理。
 * agent 侧 `BLUE_WHALE_MODEL_GATEWAY_BASE_URL` 指向这里；OpenAI 兼容客户端在其后追加 `/v1/...`
 * （见 `docs/blueprint/local-minimax-newapi-debugging.md`「配置业务 Agent API」一节）。
 *
 * - `x-agent-service-token` 头证明调用方是受信的 Agent 服务（与 `internal/agent-assets` 同一凭证、同一校验方式）
 * - `Authorization: Bearer <capability>` 原样转发给 NewAPI：该 capability 就是 NewAPI 侧计费 sk- token；
 *   由谁、何时签发这个 per-Run capability 是产品路径的后续工作（IK9DWX 下游），本控制器只做转发，不铸造凭证
 * - 全路径透传（`/v1/chat/completions`、`/v1/models` 等），去掉 `/api/internal/agent-model` 前缀后转给 NewAPI
 * - 非流式请求 60s 超时；流式（`stream: true`）不设超时，避免截断长生成
 */
@Public()
@BypassTransform()
@Controller("internal/agent-model")
export class AgentModelGatewayController {
  @All("*path")
  async proxy(
    @Req() req: Request,
    @Res() res: Response,
    @Headers("x-agent-service-token") agentServiceToken: string | undefined,
    @Headers("authorization") authorization: string | undefined,
  ): Promise<void> {
    if (!authorizedAgentService(agentServiceToken)) {
      res.status(401).json({ code: 401, msg: "服务凭证无效", data: null });
      return;
    }
    if (!NEW_API_BASE_URL) {
      res.status(503).json({ code: 503, msg: "模型网关未配置 NEW_API_BASE_URL", data: null });
      return;
    }

    const upstreamPath = req.originalUrl.startsWith(ROUTE_PREFIX)
      ? req.originalUrl.slice(ROUTE_PREFIX.length)
      : req.originalUrl;
    const upstreamUrl = `${NEW_API_BASE_URL}${upstreamPath}`;

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      const lower = key.toLowerCase();
      if (lower === "x-agent-service-token" || lower === "host") continue;
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    if (authorization) headers.authorization = authorization;

    const rawBody = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    const streaming = isStreamingRequest(rawBody);
    let upstream: globalThis.Response;
    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        signal: streaming ? null : AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      };
      if (!["GET", "HEAD"].includes(req.method)) init.body = rawBody;
      upstream = await fetch(upstreamUrl, init);
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "NewAPI 响应超时"
          : "NewAPI 不可用";
      res.status(502).json({ code: 502, msg: message, data: null });
      return;
    }

    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      if (key.toLowerCase() !== "content-length") res.set(key, value);
    }
    if (upstream.body) {
      const stream = Readable.fromWeb(
        upstream.body as import("node:stream/web").ReadableStream,
      );
      stream.on("error", (error) => {
        console.error(
          "[internal/agent-model] upstream stream error:",
          error instanceof Error ? error.message : error,
        );
        if (!res.writableEnded) res.destroy();
      });
      stream.pipe(res);
    } else {
      res.end();
    }
  }
}
