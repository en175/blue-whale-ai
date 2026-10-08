// IKHK98：POST /projects/:projectId/video-mattings — 智能抠像（火山 MediaKit
// matte-portrait-video / matte-greenscreen-video 双端点）建任务端点。入参 = 源资产引用 +
// 画布占位卡绑定 + 模式（portrait / greenscreen）+ 输出格式（WEBM / MP4，缺省 WEBM）+
// 背景色（仅 MP4，缺省 white）+ client_token 幂等键（细节见 VideoMattingsService 头注）。
import { Body, Controller, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVideoMattingJob } from "@lib/shared/generation/generation-queue.js";
import { VideoMattingsService } from "@lib/shared/video-mattings/video-mattings.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/video-mattings")
export class VideoMattingsController {
  constructor(private readonly videoMattings: VideoMattingsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.videoMattings.create(
      user.userId,
      projectId,
      body ?? {},
    );
    // IKJJQW（B.8 局部适配器）：新协议受控错误信封直写 HTTP 状态与 data.reason。
    // 本入口的幂等承载是 body 的 client_token（B.3「工具原 client_token」口径），无头。
    if (isRecoveryControlledEnvelope(result)) {
      writeRecoveryControlled(result, res);
      return;
    }
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
