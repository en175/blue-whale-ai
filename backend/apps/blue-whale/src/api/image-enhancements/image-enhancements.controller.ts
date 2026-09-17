// IKGM99：POST /projects/:projectId/image-enhancements — 图片高清放大建任务端点。
import { Body, Controller, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueImageEnhanceJob } from "@lib/shared/generation/video-queue.js";
import { ImageEnhancementsService } from "@lib/shared/image-enhancements/image-enhancements.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/image-enhancements")
export class ImageEnhancementsController {
  constructor(private readonly imageEnhancements: ImageEnhancementsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const result = await this.imageEnhancements.create(
      user.userId,
      projectId,
      body ?? {},
    );
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueImageEnhanceJob(jobId);
    } catch (error) {
      logger.error(
        `[image-enhance] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.imageEnhancements
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
