import { Readable } from "node:stream";
import {
  All,
  Controller,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

/** 上游 agent 服务地址（独立 blue-whale-agent 服务）。缺省 localhost:4111。 */
const AGENT_SERVICE_BASE_URL = process.env.AGENT_SERVICE_BASE_URL?.trim() || "http://localhost:4111";
const AGENT_UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * /api/agent/v1/* —— 到独立 blue-whale-agent 服务的 BFF 透传代理（IK9DZO / S4）。
 * 本地 dev 下前端 /api/agent/v1/* 经 vite 代理到本后端，再由本控制器原样转发到 agent 服务。
 * - 方法/路径/query/body/headers 全透传（保留 /api/agent/v1 前缀）
 * - 鉴权由上游 agent 服务校验（透传 Authorization Bearer token）
 * - 服务未启动/连不上/超时 → 502，附上游地址或超时提示便于定位
 * - SSE（/events）流式 pipe，不截断
 */
@Public()
@Controller("agent/v1")
export class AgentV1ProxyController {
  @All("*path")
  async proxy(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const base = AGENT_SERVICE_BASE_URL;
    const upstreamUrl = `${base}${req.originalUrl}`;

    // req.headers 已含 authorization（Node 请求头 key 统一小写），透传循环即可，无需单独取出再设置一次
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }

    // 读入请求体为 Buffer（GET/HEAD 无 body），透传给上游
    const rawBody = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    let upstream: globalThis.Response;
    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        signal: AbortSignal.timeout(AGENT_UPSTREAM_TIMEOUT_MS),
      };
      if (!["GET", "HEAD"].includes(req.method)) {
        init.body = rawBody;
      }
      upstream = await fetch(upstreamUrl, init);
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "上游 agent 服务响应超时"
          : `上游 agent 服务不可用（${base}）`;
      res.status(502).json({
        code: 502,
        msg: message,
        data: null,
      });
      return;
    }

    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      // 透传 content-type；其余头（含 content-length）交给 res 透传
      if (key.toLowerCase() !== "content-length") {
        res.set(key, value);
      }
    }
    if (upstream.body) {
      const stream = Readable.fromWeb(
        upstream.body as import("node:stream/web").ReadableStream,
      );
      stream.on("error", (error) => {
        logger.error(
          `[agent/v1] upstream stream error: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!res.writableEnded) res.destroy();
      });
      stream.pipe(res);
    } else {
      res.end();
    }
  }
}
