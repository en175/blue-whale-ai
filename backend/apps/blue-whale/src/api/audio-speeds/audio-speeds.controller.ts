import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueAudioSpeedJob } from "@lib/shared/generation/generation-queue.js";
import { AudioSpeedsService } from "@lib/shared/audio-speeds/audio-speeds.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";

@Controller("projects/:projectId/audio-speeds")
export class AudioSpeedsController {
  constructor(private readonly audioSpeeds: AudioSpeedsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body()
    body: {
      source_asset_id?: unknown;
      speed?: unknown;
    },
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.audioSpeeds.create(
      user.userId,
      projectId,
      body ?? {},
      idempotencyKey,
    );
    if (isRecoveryControlledEnvelope(result)) {
      writeRecoveryControlled(result, res);
      return;
    }
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueAudioSpeedJob(jobId);
    } catch (error) {
      logger.error(
        `[audio-speed] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.audioSpeeds
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
