import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVideoFrameInterpolationJob } from "@lib/shared/generation/generation-queue.js";
import { VideoFrameInterpolationsService } from "@lib/shared/video-frame-interpolations/video-frame-interpolations.service.js";
import {
  ERROR_ENQUEUE_FAILED,
  VIDEO_FRAME_INTERPOLATION_INPUT_KEYS,
  VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT,
} from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";

@Controller("projects/:projectId/video-frame-interpolations")
export class VideoFrameInterpolationsController {
  constructor(private readonly videoFrameInterpolations: VideoFrameInterpolationsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.videoFrameInterpolations.create(
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
      await enqueueVideoFrameInterpolationJob(jobId);
    } catch (error) {
      logger.error(
        `[video-frame-interpolation] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.videoFrameInterpolations
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }

  @Get(VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT)
  async findCurrent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: Record<string, string>,
  ) {
    return this.videoFrameInterpolations.findCurrent(user.userId, projectId, {
      [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]:
        query[VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId],
    });
  }
}
