import { Readable } from "node:stream";
import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import {
  TEXT_MAX_BODY_BYTES,
  TEXT_UPSTREAM_TIMEOUT_MS,
  loadTextCompletionsConfig,
  openAiError,
  resolveTextModel,
} from "@lib/shared/text/completions.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** POST /api/text/completions —— OpenAI 兼容文生文薄代理（IK6ZEH；加固 IK707U）。
 *  鉴权 + text 白名单闸，body 全透传 Go new-api /v1/chat/completions；stream=true 时 raw SSE 透传。 */
@Controller("text")
export class TextCompletionsController {
  constructor(private readonly models: ModelCapabilityReadService) {}

  @Post("completions")
  async completions(
    @CurrentUser() _user: AuthenticatedUser,
    @Body() body: unknown,
    @Headers("authorization") authorization: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const config = loadTextCompletionsConfig();
    if (!config) {
      const err = openAiError(503, "文本生成服务未配置", "config_missing");
      res.status(err.status).json(err.body);
      return;
    }

    const token = parseBearerToken(authorization);
    if (!token) {
      const err = openAiError(401, "缺少有效的 sk- 令牌", "invalid_token");
      res.status(err.status).json(err.body);
      return;
    }

    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (contentLength > TEXT_MAX_BODY_BYTES) {
      const err = openAiError(413, "请求体过大（上限 1MB）", "payload_too_large");
      res.status(err.status).json(err.body);
      return;
    }

    const record =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    const gate = await resolveTextModel(record.model, record.messages, {
      models: this.models,
    });
    if (!gate.ok) {
      const err = openAiError(gate.status, gate.message, gate.code);
      res.status(err.status).json(err.body);
      return;
    }

    // 非流请求防 Go 挂起拖死连接；流式 SSE 长连接不加超时（不截断）。
    const isStream = record.stream === true;
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: isStream
          ? null
          : AbortSignal.timeout(TEXT_UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        const err = openAiError(504, "上游响应超时", "upstream_timeout");
        res.status(err.status).json(err.body);
        return;
      }
      const err = openAiError(502, "上游请求失败", "upstream_error");
      res.status(err.status).json(err.body);
      return;
    }

    res.status(upstream.status);
    res.set(
      "content-type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    if (upstream.body) {
      const stream = Readable.fromWeb(
        upstream.body as import("node:stream/web").ReadableStream,
      );
      stream.on("error", (error) => {
        console.error(
          "[text/completions] upstream stream error:",
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
