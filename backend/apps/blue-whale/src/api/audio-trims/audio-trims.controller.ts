// IKHB6N：POST /projects/:projectId/audio-trims — 音频截取（画布音频卡「截取」）建任务端点。
// 同构 media-extractions.controller（IKARDY/IKH28V 先例）：请求方凭证冻结 + RocketMQ 入队 +
// 入队失败 markFailed(enqueue_failed) 兜底。契约 = @lib/contracts/audio-trim（IKHB6F）。
import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueAudioTrimJob } from "@lib/shared/generation/generation-queue.js";
import { AudioTrimsService } from "@lib/shared/audio-trims/audio-trims.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";

@Controller("projects/:projectId/audio-trims")
export class AudioTrimsController {
  constructor(private readonly audioTrims: AudioTrimsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body()
    body: {
      source_asset_id?: unknown;
      start_time?: unknown;
      end_time?: unknown;
      output_format?: unknown;
    },
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.audioTrims.create(
      user.userId,
      projectId,
      body ?? {},
      idempotencyKey,
    );
    // IKJJQW（B.8 局部适配器）：新协议受控错误信封直写 HTTP 状态与 data.reason。
    if (isRecoveryControlledEnvelope(result)) {
      writeRecoveryControlled(result, res);
      return;
    }
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueAudioTrimJob(jobId);
    } catch (error) {
      logger.error(
        `[audio-trim] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.audioTrims
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
