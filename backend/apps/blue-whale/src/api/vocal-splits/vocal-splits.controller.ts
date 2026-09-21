// IKHA2I：POST /projects/:projectId/vocal-splits — 人声背景分离建任务端点（契约
// @lib/contracts/vocal-split，行为同构 media-extractions / video-enhancements）。
import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVocalSplitJob } from "@lib/shared/generation/video-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { VocalSplitsService } from "@lib/shared/vocal-splits/vocal-splits.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/vocal-splits")
export class VocalSplitsController {
  constructor(private readonly vocalSplits: VocalSplitsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: { source_asset_id?: unknown; scene?: unknown; output_format?: unknown },
    @Headers("authorization") authorization?: string,
  ) {
    // 与去字幕 / 音视频分离同构（media-extractions.controller.ts）：从请求 Authorization
    // 头取请求方 sk-，冻结进 job input.provider_credential，worker 处理时直接取用
    // （未携带/非 sk- 为空对象）。
    const internal = sealProviderCredential(authorization);
    const result = await this.vocalSplits.create(
      user.userId,
      projectId,
      body ?? {},
      internal,
    );
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueVocalSplitJob(jobId);
    } catch (error) {
      logger.error(
        `[vocal-split] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.vocalSplits
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
