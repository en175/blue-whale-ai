import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVocalSplitJob } from "@lib/shared/generation/generation-queue.js";
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
    @Body() body: { source_asset_id?: unknown; scene?: unknown; output_format?: unknown; canvas_binding?: unknown },
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const result = await this.vocalSplits.create(
      user.userId,
      projectId,
      body ?? {},
      idempotencyKey,
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
