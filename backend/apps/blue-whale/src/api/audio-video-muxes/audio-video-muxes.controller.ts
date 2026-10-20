import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { DomainError, ERROR_ENQUEUE_FAILED, FAILURE_CODE } from "@lib/contracts";
import { enqueueAudioVideoMuxJob } from "@lib/shared/generation/generation-queue.js";
import { AudioVideoMuxesService } from "@lib/shared/audio-video-muxes/audio-video-muxes.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { isRecoveryControlledEnvelope } from "../recovery-envelope.js";

@Controller("projects/:projectId/audio-video-muxes")
export class AudioVideoMuxesController {
  constructor(private readonly audioVideoMuxes: AudioVideoMuxesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.audioVideoMuxes.create(
      user.userId,
      projectId,
      body ?? {},
      { idempotencyKey: idempotencyKey ?? "" },
    );
    if (isRecoveryControlledEnvelope(result)) {
      res?.status(result.code).json(result);
      return;
    }
    if (!result.data?.enqueue_required) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueAudioVideoMuxJob(jobId);
    } catch (error) {
      logger.error(`[audio_video_mux] enqueue failed jobId=${jobId}: ${error instanceof Error ? error.message : String(error)}`);
      await this.audioVideoMuxes.markFailed(user.userId, jobId, ERROR_ENQUEUE_FAILED, "任务入队失败");
      throw new DomainError(FAILURE_CODE, "任务入队失败");
    }
    return result;
  }

  @Post(":jobId/retry")
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Body() body?: unknown,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const canvasBindingBody = typeof body === "object" && body !== null
      ? (body as { canvas_binding?: unknown }).canvas_binding
      : undefined;
    const result = await this.audioVideoMuxes.retry(
      user.userId,
      projectId,
      jobId,
      idempotencyKey ?? "",
      canvasBindingBody,
    );
    if (isRecoveryControlledEnvelope(result)) {
      res?.status(result.code).json(result);
      return;
    }
    if (result.data?.enqueue_required) {
      const retryJobId = String(result.data.job_id);
      try {
        await enqueueAudioVideoMuxJob(retryJobId);
      } catch (error) {
        logger.error(`[audio_video_mux] retry enqueue failed jobId=${retryJobId}: ${error instanceof Error ? error.message : String(error)}`);
        const status = await this.audioVideoMuxes.markFailed(user.userId, retryJobId, ERROR_ENQUEUE_FAILED, "重试任务入队失败");
        if (status === "failed") throw new DomainError(FAILURE_CODE, "重试任务入队失败");
        return { ...result, data: { ...result.data, status } };
      }
    }
    return result;
  }
}
