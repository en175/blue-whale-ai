import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  DomainError,
  fail,
  ok,
  RESOURCE_NOT_FOUND_CODE,
  type ResultEnvelope,
} from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { wireInteger } from "@lib/shared/wire-integer.js";
import { sharedBillingClient } from "@lib/shared/billing/billing-client.js";
import { SceneCardGenerationService } from "@lib/shared/generation/scene-card-generation.service.js";
import { createRequestMaterialGate } from "@lib/shared/generation/material-gate-wiring.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { StoryboardPreviewService } from "@lib/shared/generation/storyboard-preview.service.js";
import { handleSceneCardGenerate } from "@lib/shared/generation/handle-scene-card-generate.js";
import { handleStoryboardPreviewCreate } from "@lib/shared/generation/handle-storyboard-preview-create.js";
import {
  enqueueVideoGenerationJob,
  enqueueImageGenerationJob,
} from "@lib/shared/generation/generation-queue.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { enqueueFailureLog } from "@lib/infra/mq/rocketmq-producer.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
// IKJKUA：受控错误判定收敛到共享适配器（原 IKJJR0 B.8 本地同款副本已删）。
import { isRecoveryControlledEnvelope } from "../recovery-envelope.js";

function bodyString(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body ?? "");
}

@Controller("projects/:projectId/scene-cards/:sceneCardId")
export class SceneCardGenerateController {
  constructor(
    private readonly sceneCard: SceneCardGenerationService,
    private readonly storyboard: StoryboardPreviewService,
    // IKF YHJ：素材校验门（场景卡再生成是第三条视频创建路径）。
    private readonly material: MaterialService,
    private readonly assets: AssetService,
  ) {}

  @Post("generate")
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("sceneCardId") sceneCardId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res() res: Response,
  ) {
    const result = await handleSceneCardGenerate(
      user.userId,
      projectId,
      sceneCardId,
      idempotencyKey ?? null,
      bodyString(body),
      this.sceneCard.repo,
      {
        // IKF YHJ（ADR-0087）：场景卡再生成是第三条视频创建路径，与创建期/重试期共用同一个门
        // （同一工厂、同一判定、同一失败处置）。原先漏接，导致预设保存后才变成 Failed 的素材
        // 仍能从这里进生成。
        materialGate: createRequestMaterialGate({
          repo: this.material.materialStatusRepo,
          callAction: (action, body) =>
            this.material.callAction(action, body),
          resolveLocalAssetMaterialIds: (uid, assetIds) =>
            this.assets.findBoundMaterialIds(uid, assetIds),
          onMaterialFailure: (input) =>
            this.material
              .handleUpstreamMaterialFailure({
                userId: user.userId,
                materialId: input.materialId,
                errorCode: input.errorCode,
                errorMessage: input.errorMessage,
                ...(input.deleteUpstream === false ? { deleteUpstream: false } : {}),
              })
              .catch((error: unknown) => {
                // 处置是清理副作用，绝不外抛——抛了会被门的 try 咽成「本轮未知」，
                // 把本该终局拒绝的结果降级成「请稍后重试」。
                logger.warn(
                  `[scene-card-generate] 素材失败处置异常 materialId=${input.materialId}: ${
                    error instanceof Error ? error.message : "unknown"
                  }`,
                );
              }),
        }),
      },
    );
    if (result.code === 200 && result.data?.generation_job_id != null) {
      const jobId = String(result.data.generation_job_id);
      try {
        await enqueueVideoGenerationJob(jobId);
      } catch (error) {
        // IKJ80Q：缺配≠故障——任务行已落库，worker 恢复扫描会捞起派发，降 WARN；真失败 ERROR。
        const log = enqueueFailureLog(error, { scope: "scene-card-generate", kind: "video", jobId });
        logger[log.level](log.message);
      }
    }
    // IKIQGQ：业务拒绝/成功受理的写盘口径见 writeAcceptedOrThrow
    this.writeAcceptedOrThrow(result, res);
  }

  /** IKIQGQ：业务拒绝不再写 200 + fail 信封——抛 DomainError 走 AllExceptionsFilter 统一投影
   *  （同 generation-jobs create/cancel/retry 口径），code、msg、HTTP 状态同出一张码表。
   *  成功受理（含 job）保持 202 Accepted。 */
  private writeAcceptedOrThrow(
    result: ResultEnvelope<unknown>,
    res: Response,
  ): void {
    if (result.code !== 200) {
      throw new DomainError(result.code, result.msg ?? undefined);
    }
    res.status(202).json(result);
  }

  /** GET /api/projects/:projectId/scene-cards/:sceneCardId/generation-preset
   *  编辑器只读端点：返回当前 Preset 完整参数 + SceneCard 版本与权威正文（完整参数不进 Snapshot）。 */
  @Get("generation-preset")
  async generationPreset(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("sceneCardId") sceneCardId: string,
  ) {
    const result = await this.sceneCard.repo.getSceneCardGenerationPreset(
      projectId,
      sceneCardId,
      user.userId,
    );
    if (result.kind !== "found") {
      return fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在");
    }
    return ok({
      scene_card: {
        scene_card_id: wireInteger(result.scene_card.scene_card_id),
        version: result.scene_card.version,
        title: result.scene_card.title,
        content_markdown: result.scene_card.content_markdown,
      },
      preset: {
        version: result.preset.version,
        parameters: result.preset.parameters,
        reference_mode: result.preset.reference_mode,
        reference_assets: result.preset.reference_assets,
        capability_snapshot_version: result.preset.capability_snapshot_version,
      },
    });
  }

  @Post("storyboard-preview")
  async storyboardPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("sceneCardId") sceneCardId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res() res: Response,
  ) {
    // 余额预检问 billing：new-api 那把 key 是全项目共用的，问它「余额够不够」
    // 得到的是统一 key 属主的余额，与发起人无关。
    const quotaCheck = async () => {
      const balance = await sharedBillingClient().queryBalance(Number(user.userId));
      return { sufficient: balance.availableCredits > 0 };
    };

    const result = await handleStoryboardPreviewCreate(
      user.userId,
      projectId,
      sceneCardId,
      idempotencyKey ?? null,
      bodyString(body),
      this.storyboard.repo,
      {
        quotaCheck,
      },
    );

    // 成功后即时调度首图 job（IKBGKA：走 RocketMQ 图片 consumer，消费端 Semaphore 控并发；
    // 孤儿由 worker-java RecoveryService 重投 MQ 兜底）。
    if (result.code === 200 && result.data?.generation_job_id != null) {
      const jobId = String(result.data.generation_job_id);
      void enqueueImageGenerationJob(jobId).catch((e) => {
        // IKJ80Q：缺配≠故障，恢复扫描兜底（同上 video 分支），降 WARN；真失败 ERROR。
        const log = enqueueFailureLog(e, { scope: "storyboard-preview", kind: "image", jobId });
        logger[log.level](log.message);
      });
    }

    // IKJJR0（B.8 局部适配器）：新协议受控错误（canvas_binding_conflict 等）信封直写
    // HTTP 状态与 data.reason，不经 AllExceptionsFilter（它会置空 data）。
    if (isRecoveryControlledEnvelope(result)) {
      res.status(result.code).json(result);
      return;
    }
    // IKIQGQ：业务拒绝/成功受理的写盘口径见 writeAcceptedOrThrow
    this.writeAcceptedOrThrow(result, res);
  }

  /** GET /api/projects/:projectId/scene-cards/:sceneCardId/storyboard-preview
   *  只读端点：返回该 SceneCard 下所有未删除分镜预览（按 id 升序）及其画格候选。 */
  @Get("storyboard-preview")
  async listStoryboardPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("sceneCardId") sceneCardId: string,
  ) {
    const [previewsResult, framesResult] = await Promise.all([
      this.storyboard.repo.listStoryboardPreviews(
        projectId,
        sceneCardId,
        user.userId,
      ),
      this.storyboard.repo.listStoryboardFrames(
        projectId,
        sceneCardId,
        user.userId,
      ),
    ]);
    if (previewsResult.kind !== "found" || framesResult.kind !== "found") {
      return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    }
    return ok({
      previews: previewsResult.previews.map((preview) => ({
        preview_id: wireInteger(preview.preview_id),
        scene_card_id: wireInteger(preview.scene_card_id),
        first_generation_job_id: wireInteger(preview.first_generation_job_id),
        summary_status: preview.summary_status,
      })),
      frames: framesResult.frames.map((frame) => ({
        slot_id: wireInteger(frame.slot_id),
        asset_id: wireInteger(frame.asset_id),
        slot_index: frame.slot_index,
      })),
    });
  }
}
