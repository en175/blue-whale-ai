// IKH8BO：POST /projects/:projectId/video-scene-splits — 视频场景切分（火山 MediaKit
// segment-scenes）建任务端点。入参 = 源资产引用 + 画布占位卡绑定 + 粒度档位 + client_token
// 幂等键（细节见 VideoSceneSplitsService 头注）。
import { Body, Controller, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVideoSceneSplitJob } from "@lib/shared/generation/generation-queue.js";
import { VideoSceneSplitsService } from "@lib/shared/video-scene-splits/video-scene-splits.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/video-scene-splits")
export class VideoSceneSplitsController {
  constructor(private readonly videoSceneSplits: VideoSceneSplitsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const result = await this.videoSceneSplits.create(
      user.userId,
      projectId,
      body ?? {},
    );
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueVideoSceneSplitJob(jobId);
    } catch (error) {
      logger.error(
        `[video-scene-split] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.videoSceneSplits
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
