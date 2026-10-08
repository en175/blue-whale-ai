import { Body, Controller, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVideoMattingJob } from "@lib/shared/generation/generation-queue.js";
import { VideoMattingsService } from "@lib/shared/video-mattings/video-mattings.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/video-mattings")
export class VideoMattingsController {
  constructor(private readonly videoMattings: VideoMattingsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.videoMattings.create(
      user.userId,
      projectId,
      body ?? {},
    );
    if (isRecoveryControlledEnvelope(result)) {
      writeRecoveryControlled(result, res);
      return;
    }
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueVideoMattingJob(jobId);
    } catch (error) {
      logger.error(
        `[video-matting] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.videoMattings
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
