import { Readable } from "node:stream";
import {
  Body,
  Controller,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { newApiFetch } from "@lib/shared/upstream/new-api-egress.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import {
  TEXT_MAX_BODY_BYTES,
  TEXT_UPSTREAM_TIMEOUT_MS,
  loadTextCompletionsConfig,
  openAiError,
  resolveTextModel,
} from "@lib/shared/text/completions.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("text")
export class TextCompletionsController {
  constructor(
    private readonly models: ModelCapabilityReadService,
    private readonly settings: SystemSettingsService,
  ) {}

  @Post("completions")
  async completions(
    @CurrentUser() _user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const config = loadTextCompletionsConfig();
    if (!config) {
      const err = openAiError(503, "文本生成服务未配置", "config_missing");
      res.status(err.status).json(err.body);
      return;
    }

    const token = await this.settings.requireUpstreamKey();

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

    const isStream = record.stream === true;
    let upstream: globalThis.Response;
    try {
      upstream = await newApiFetch("/v1/chat/completions", {
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
        logger.error(
          `[text/completions] upstream stream error: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!res.writableEnded) res.destroy();
      });
      stream.pipe(res);
    } else {
      res.end();
    }
  }
}
