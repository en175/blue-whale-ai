import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { DomainError, ERROR_ENQUEUE_FAILED, FAILURE_CODE } from "@lib/contracts";
import { enqueueAudioMixJob } from "@lib/shared/generation/generation-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { AudioMixesService } from "@lib/shared/audio-mixes/audio-mixes.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
// IKJKUA：受控错误判定收敛到共享适配器（原 IKJJQZ B.8 本地同款副本已删）。
import { isRecoveryControlledEnvelope } from "../recovery-envelope.js";

@Controller("projects/:projectId/audio-mixes")
export class AudioMixesController {
  constructor(private readonly audioMixes: AudioMixesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.audioMixes.create(
      user.userId,
      projectId,
      body ?? {},
      { ...sealProviderCredential(authorization), idempotencyKey: idempotencyKey ?? "" },
    );
    if (isRecoveryControlledEnvelope(result)) {
      res?.status(result.code).json(result);
      return;
    }
    if (!result.data?.enqueue_required) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueAudioMixJob(jobId);
    } catch (error) {
      logger.error(`[audio_mix] enqueue failed jobId=${jobId}: ${error instanceof Error ? error.message : String(error)}`);
      await this.audioMixes.markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败");
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
    @Headers("authorization") authorization?: string,
    @Body() body?: unknown,
    @Res({ passthrough: true }) res?: Response,
  ) {
    // IKJJQZ：专属重试可携带 canvas_binding（body 为对象时取其 canvas_binding 字段）。
    const canvasBindingBody = typeof body === "object" && body !== null
      ? (body as { canvas_binding?: unknown }).canvas_binding
      : undefined;
    const result = await this.audioMixes.retry(
      user.userId,
      projectId,
      jobId,
      idempotencyKey ?? "",
      sealProviderCredential(authorization).providerCredential,
      canvasBindingBody,
    );
    if (isRecoveryControlledEnvelope(result)) {
      res?.status(result.code).json(result);
      return;
    }
    if (result.data?.enqueue_required) {
      try {
        await enqueueAudioMixJob(jobId);
      } catch (error) {
        logger.error(`[audio_mix] retry enqueue failed jobId=${jobId}: ${error instanceof Error ? error.message : String(error)}`);
        const status = await this.audioMixes.markFailed(jobId, ERROR_ENQUEUE_FAILED, "重试任务入队失败");
        if (status === "failed") throw new DomainError(FAILURE_CODE, "重试任务入队失败");
        return { ...result, data: { ...result.data, status } };
      }
    }
    return result;
  }

}
