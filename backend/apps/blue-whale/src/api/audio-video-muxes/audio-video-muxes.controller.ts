import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { DomainError, ERROR_ENQUEUE_FAILED, FAILURE_CODE, RECOVERY_HTTP_STATUSES } from "@lib/contracts";
import { enqueueAudioVideoMuxJob } from "@lib/shared/generation/generation-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { AudioVideoMuxesService } from "@lib/shared/audio-video-muxes/audio-video-muxes.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** IKJJQZ（B.8 局部适配器）：新协议受控错误判定——code 即 HTTP 状态且 data.reason 为
 *  稳定字符串。这些信封直写状态码（AllExceptionsFilter 会置空 data）。 */
function isRecoveryControlled(result: { code: number; data: unknown }): boolean {
  return RECOVERY_HTTP_STATUSES.has(result.code)
    && typeof result.data === "object" && result.data !== null
    && typeof (result.data as { reason?: unknown }).reason === "string";
}

@Controller("projects/:projectId/audio-video-muxes")
export class AudioVideoMuxesController {
  constructor(private readonly audioVideoMuxes: AudioVideoMuxesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.audioVideoMuxes.create(
      user.userId,
      projectId,
      body ?? {},
      { ...sealProviderCredential(authorization), idempotencyKey: idempotencyKey ?? "" },
    );
    if (isRecoveryControlled(result)) {
      res?.status(result.code).json(result);
      return;
    }
    if (!result.data?.enqueue_required) return result;
    const jobId = String(result.data.job_id);
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
    @Body() body?: unknown,
    @Res({ passthrough: true }) res?: Response,
  ) {
    // IKJJQZ：专属重试可携带 canvas_binding（body 为对象时取其 canvas_binding 字段）。
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
    if (isRecoveryControlled(result)) {
      res?.status(result.code).json(result);
      return;
    }
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
