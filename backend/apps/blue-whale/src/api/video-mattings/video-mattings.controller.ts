// IKHK98：POST /projects/:projectId/video-mattings — 智能抠像（火山 MediaKit
// matte-portrait-video / matte-greenscreen-video 双端点）建任务端点。入参 = 源资产引用 +
// 画布占位卡绑定 + 模式（portrait / greenscreen）+ 输出格式（WEBM / MP4，缺省 WEBM）+
// 背景色（仅 MP4，缺省 white）+ client_token 幂等键（细节见 VideoMattingsService 头注）。
import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVideoMattingJob } from "@lib/shared/generation/video-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { VideoMattingsService } from "@lib/shared/video-mattings/video-mattings.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/video-mattings")
export class VideoMattingsController {
  constructor(private readonly videoMattings: VideoMattingsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
  ) {
    // 与去字幕 / HD / 场景切分同构（video-scene-splits.controller.ts）：从请求
    // Authorization 头取请求方 sk-，冻结进 job input.provider_credential，worker 处理时直接
    // 取用（未携带/非 sk- 为空对象）。
    const internal = sealProviderCredential(authorization);
    const result = await this.videoMattings.create(
      user.userId,
      projectId,
      body ?? {},
      internal,
    );
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueVideoMattingJob(jobId);
    } catch (error) {
      logger.error(
        `[video-matting] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.videoMattings
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
