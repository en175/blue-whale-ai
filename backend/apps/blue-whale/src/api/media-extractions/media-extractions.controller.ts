// IKARDY：POST /projects/:projectId/media-extractions — 视频提取音频建任务端点。
import { Body, Controller, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueMediaExtractJob } from "@lib/shared/generation/video-queue.js";
import { MediaExtractionsService } from "@lib/shared/media-extractions/media-extractions.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/shared/jobs/error-codes.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/media-extractions")
export class MediaExtractionsController {
  constructor(private readonly mediaExtractions: MediaExtractionsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: { source_asset_id?: unknown; output_format?: unknown },
  ) {
    const result = await this.mediaExtractions.create(
      user.userId,
      projectId,
      body ?? {},
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
