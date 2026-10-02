// IKHLK3：POST /projects/:projectId/video-frame-interpolations — 视频插帧（火山 MediaKit
// video-frame-interpolation）建任务端点。
// IKHSFE：GET /projects/:projectId/video-frame-interpolations/current — 恢复查询端点
// （浏览器未收到创建响应就关页时，按项目 + 目标节点查回当前任务关联）。
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { enqueueVideoFrameInterpolationJob } from "@lib/shared/generation/generation-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { VideoFrameInterpolationsService } from "@lib/shared/video-frame-interpolations/video-frame-interpolations.service.js";
import {
  ERROR_ENQUEUE_FAILED,
  VIDEO_FRAME_INTERPOLATION_INPUT_KEYS,
  VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT,
} from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";

@Controller("projects/:projectId/video-frame-interpolations")
export class VideoFrameInterpolationsController {
  constructor(private readonly videoFrameInterpolations: VideoFrameInterpolationsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    // 免费口径（ADR-0113 同 HD 高清 / 去字幕）：不走积分预估与余额拦截门。
    // IKJJQW（B.3）：新协议请求带 Idempotency-Key（= canvas_binding.submission_id）；老请求不带不受影响。
    @Headers("authorization") authorization?: string,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    // 与 HD 高清 / 去字幕同构：从请求 Authorization 头取请求方 sk-，冻结进 job input.provider_credential，
    // worker（IKHLKJ 注册的处理器）处理时直接取用（未携带/非 sk- 为空对象）。
    const internal = sealProviderCredential(authorization);
    const result = await this.videoFrameInterpolations.create(
      user.userId,
      projectId,
      body ?? {},
      internal,
      idempotencyKey,
    );
    // IKJJQW（B.8 局部适配器）：新协议受控错误信封直写 HTTP 状态与 data.reason。
    if (isRecoveryControlledEnvelope(result)) {
      writeRecoveryControlled(result, res);
      return;
    }
    if (result.code !== 200 || !result.data) return result;
    const jobId = String(result.data.job_id);
    try {
      await enqueueVideoFrameInterpolationJob(jobId);
    } catch (error) {
      logger.error(
        `[video-frame-interpolation] enqueue failed jobId=${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // 入队失败仍返回 200：job 已持久化，终态由 GET /api/jobs/:id 轮询呈现。
      // 落库 job 错误码 = ERROR_ENQUEUE_FAILED（字符串 enqueue_failed / 数值 1028），
      // 此处 msg 只是码表半句「任务入队失败」；对客逐字全文「任务入队失败，请重试」由前端
      // 映射给出（frameInterpolationErrorText 对入队失败码固定返回该句，不取后端 msg）。
      // details.raw 是内部调试原文（RocketMQ 报错），ADR-0078 禁展示用户。
      await this.videoFrameInterpolations
        .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
          raw: "RocketMQ 入队失败",
        })
        .catch(() => {});
    }
    return result;
  }

  /** 恢复查询（IKHSFE）：GET .../current?target_node_id=xxx。只挑契约单键透传，判定与投影
   *  归 service.findCurrent（契约口径见 video-frame-interpolation.ts 恢复查询节）。
   *  query 空入参防御在 service 判定入口（safeParse(query ?? {})）单点收口：Nest @Query()
   *  无查询串时注入空对象，controller 不再做默认值双重防御（IKHSFE review 修订）。 */
  @Get(VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT)
  async findCurrent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: Record<string, string>,
  ) {
    return this.videoFrameInterpolations.findCurrent(user.userId, projectId, {
      [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]:
        query[VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId],
    });
  }
}
