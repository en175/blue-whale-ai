import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { DomainError, ERROR_ENQUEUE_FAILED, FAILURE_CODE } from "@lib/contracts";
import { enqueueAudioVideoMuxJob } from "@lib/shared/generation/generation-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { AudioVideoMuxesService } from "@lib/shared/audio-video-muxes/audio-video-muxes.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/audio-video-muxes")
export class AudioVideoMuxesController {
  constructor(private readonly audioVideoMuxes: AudioVideoMuxesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const result = await this.audioVideoMuxes.create(
      user.userId,
      projectId,
      body ?? {},
      sealProviderCredential(authorization),
    );
    if (!result.data?.enqueue_required) return result;
    const jobId = result.data.job_id;
    try {
      await enqueueAudioVideoMuxJob(jobId);
    } catch (error) {
      logger.error(`[audio_video_mux] enqueue failed jobId=${jobId}: ${error instanceof Error ? error.message : String(error)}`);
      await this.audioVideoMuxes.markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败");
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
  ) {
    const result = await this.audioVideoMuxes.retry(user.userId, projectId, jobId, idempotencyKey ?? "");
    if (result.data?.enqueue_required) {
      try {
        await enqueueAudioVideoMuxJob(jobId);
      } catch (error) {
        logger.error(`[audio_video_mux] retry enqueue failed jobId=${jobId}: ${error instanceof Error ? error.message : String(error)}`);
        const status = await this.audioVideoMuxes.markFailed(jobId, ERROR_ENQUEUE_FAILED, "重试任务入队失败");
        if (status === "failed") throw new DomainError(FAILURE_CODE, "重试任务入队失败");
        return { ...result, data: { ...result.data, status } };
      }
    }
    return result;
  }
}
