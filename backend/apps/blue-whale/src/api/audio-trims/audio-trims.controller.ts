// IKHB6N：POST /projects/:projectId/audio-trims — 音频截取（画布音频卡「截取」）建任务端点。
// 同构 media-extractions.controller（IKARDY/IKH28V 先例）：请求方凭证冻结 + RocketMQ 入队 +
// 入队失败 markFailed(enqueue_failed) 兜底。契约 = @lib/contracts/audio-trim（IKHB6F）。
import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueAudioTrimJob } from "@lib/shared/generation/video-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { AudioTrimsService } from "@lib/shared/audio-trims/audio-trims.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/audio-trims")
export class AudioTrimsController {
  constructor(private readonly audioTrims: AudioTrimsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body()
    body: {
      source_asset_id?: unknown;
      start_time?: unknown;
      end_time?: unknown;
      output_format?: unknown;
    },
    @Headers("authorization") authorization?: string,
  ) {
    // 与 media_extract / 去字幕同构：从请求 Authorization 头取请求方 sk-，冻结进
    // job input.provider_credential，worker 直接取用（未携带/非 sk- 为空对象）。
    const internal = sealProviderCredential(authorization);
    const result = await this.audioTrims.create(
      user.userId,
      projectId,
      body ?? {},
      internal,
    );
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueAudioTrimJob(jobId);
    } catch (error) {
      logger.error(
        `[audio-trim] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.audioTrims
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
