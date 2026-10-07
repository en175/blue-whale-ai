// IKGXM1：POST /projects/:projectId/image-cutouts — 图片抠图建任务端点。
import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueImageCutoutJob } from "@lib/shared/generation/generation-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { ImageCutoutsService } from "@lib/shared/image-cutouts/image-cutouts.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";

@Controller("projects/:projectId/image-cutouts")
export class ImageCutoutsController {
  constructor(private readonly imageCutouts: ImageCutoutsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    // 与图片生成 / 擦除同构（generation-jobs.controller.ts）：从请求 Authorization 头取请求方 sk-，
    // 冻结进 job input.provider_credential，worker 处理时直接取用（未携带/非 sk- 为空对象）。
    const internal = sealProviderCredential(authorization);
    const result = await this.imageCutouts.create(
      user.userId,
      projectId,
      body ?? {},
      internal,
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
      await enqueueImageCutoutJob(jobId);
    } catch (error) {
      logger.error(
        `[image-cutout] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.imageCutouts
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
