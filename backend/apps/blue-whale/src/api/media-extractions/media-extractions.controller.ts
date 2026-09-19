// IKARDY：POST /projects/:projectId/media-extractions — 视频提取音频建任务端点。
// IKH28V：补请求方凭证冻结链（去字幕同构）——请求体结构不变（ADR-0103）。
import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueMediaExtractJob } from "@lib/shared/generation/video-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { MediaExtractionsService } from "@lib/shared/media-extractions/media-extractions.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/media-extractions")
export class MediaExtractionsController {
  constructor(private readonly mediaExtractions: MediaExtractionsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: { source_asset_id?: unknown; output_format?: unknown },
    @Headers("authorization") authorization?: string,
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
    );
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
