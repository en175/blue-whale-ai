// IKGOQV：POST /projects/:projectId/image-outpaints — 画布图片扩图建任务端点。
import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueImageOutpaintJob } from "@lib/shared/generation/video-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { ImageOutpaintsService } from "@lib/shared/image-outpaints/image-outpaints.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/image-outpaints")
export class ImageOutpaintsController {
  constructor(private readonly imageOutpaints: ImageOutpaintsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
  ) {
    // 与图片生成/高清放大同构（IKGLZV 审查 P0 口径）：从请求 Authorization 头取请求方 sk-，
    // 冻结进 job input.provider_credential，worker 处理时直接取用（未携带/非 sk- 为空对象）。
    const internal = sealProviderCredential(authorization);
    const result = await this.imageOutpaints.create(
      user.userId,
      projectId,
      body ?? {},
      internal,
    );
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueImageOutpaintJob(jobId);
    } catch (error) {
      logger.error(
        `[image-outpaint] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.imageOutpaints
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }
}
