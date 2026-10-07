// IKARDY：POST /projects/:projectId/media-extractions — 视频提取音频建任务端点。
// IKH28V：补请求方凭证冻结链（去字幕同构）——请求体结构不变（ADR-0103）。
import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueMediaExtractJob } from "@lib/shared/generation/generation-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { MediaExtractionsService } from "@lib/shared/media-extractions/media-extractions.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";

@Controller("projects/:projectId/media-extractions")
export class MediaExtractionsController {
  constructor(private readonly mediaExtractions: MediaExtractionsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: { source_asset_id?: unknown; output_format?: unknown },
    @Headers("authorization") authorization?: string,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    // 与去字幕 / 图片生成同构（video-subtitle-erasures.controller.ts）：从请求 Authorization
    // 头取请求方 sk-，冻结进 job input.provider_credential，worker 切网关后（IKH28W）直接取用
    // （未携带/非 sk- 为空对象）。
    const internal = sealProviderCredential(authorization);
    const result = await this.mediaExtractions.create(
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
      await enqueueMediaExtractJob(jobId);
    } catch (error) {
      logger.error(
        `[media-extract] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.mediaExtractions
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
