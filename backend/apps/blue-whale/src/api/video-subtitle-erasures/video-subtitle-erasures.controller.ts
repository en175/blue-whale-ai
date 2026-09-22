// IKGZ80：POST /projects/:projectId/video-subtitle-erasures — 视频智能去字幕建任务端点。
import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVideoSubtitleEraseJob } from "@lib/shared/generation/generation-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { VideoSubtitleErasuresService } from "@lib/shared/video-subtitle-erasures/video-subtitle-erasures.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/video-subtitle-erasures")
export class VideoSubtitleErasuresController {
  constructor(private readonly videoSubtitleErasures: VideoSubtitleErasuresService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
  ) {
    // 与图片生成 / 擦除同构（generation-jobs.controller.ts）：从请求 Authorization 头取请求方 sk-，
    // 冻结进 job input.provider_credential，worker 处理时直接取用（未携带/非 sk- 为空对象）。
    const internal = sealProviderCredential(authorization);
    const result = await this.videoSubtitleErasures.create(
      user.userId,
      projectId,
      body ?? {},
      internal,
    );
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueVideoSubtitleEraseJob(jobId);
    } catch (error) {
      logger.error(
        `[video-subtitle-erase] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.videoSubtitleErasures
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
