// IKH8BO：POST /projects/:projectId/video-scene-splits — 视频场景切分（火山 MediaKit
// segment-scenes）建任务端点。入参 = 源资产引用 + 画布占位卡绑定 + 粒度档位 + client_token
// 幂等键（细节见 VideoSceneSplitsService 头注）。
import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVideoSceneSplitJob } from "@lib/shared/generation/video-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
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
    @Headers("authorization") authorization?: string,
  ) {
    // 与去字幕 / HD / 音视频分离同构（video-subtitle-erasures.controller.ts）：从请求
    // Authorization 头取请求方 sk-，冻结进 job input.provider_credential，worker 处理时直接
    // 取用（未携带/非 sk- 为空对象）。
    const internal = sealProviderCredential(authorization);
    const result = await this.videoSceneSplits.create(
      user.userId,
      projectId,
      body ?? {},
      internal,
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
