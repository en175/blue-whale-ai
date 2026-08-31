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
import { fail, ok, RESOURCE_NOT_FOUND_CODE } from "@blue-whale/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { wireInteger } from "@lib/shared/wire-integer.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { SceneCardGenerationService } from "@lib/shared/generation/scene-card-generation.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";
import { StoryboardPreviewService } from "@lib/shared/generation/storyboard-preview.service.js";
import { handleSceneCardGenerate } from "@lib/shared/generation/handle-scene-card-generate.js";
import { handleStoryboardPreviewCreate } from "@lib/shared/generation/handle-storyboard-preview-create.js";
import {
  enqueueVideoGenerationJob,
  enqueueImageGenerationJob,
} from "@lib/shared/generation/video-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

function bodyString(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body ?? "");
}

@Controller("projects/:projectId/scene-cards/:sceneCardId")
export class SceneCardGenerateController {
  constructor(
    private readonly sceneCard: SceneCardGenerationService,
    private readonly storyboard: StoryboardPreviewService,
    private readonly cost: GenerationCostEstimatorService,
    private readonly account: AccountService,
  ) {}

  @Post("generate")
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("sceneCardId") sceneCardId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("authorization") authorization: string | undefined,
    @Res() res: Response,
  ) {
    const internal = sealProviderCredential(authorization);
    const result = await handleSceneCardGenerate(
      user.userId,
      projectId,
      sceneCardId,
      idempotencyKey ?? null,
      bodyString(body),
      this.sceneCard.repo,
      {
        ...(internal.providerCredential
          ? { providerCredential: internal.providerCredential }
          : {}),
        ...(this.cost.estimator
          ? { costEstimator: this.cost.estimator }
          : {}),
      },
    );
    if (result.code === 200 && result.data?.generation_job_id != null) {
      try {
        await enqueueVideoGenerationJob(
          String(result.data.generation_job_id),
        );
      } catch (error) {
        logger.error(
          `[scene-card-generate] enqueue video job failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }
    // 对齐原 web 路由：成功受理（含 job）返 202 Accepted，业务错误返 200 + 信封。
    res.status(result.code === 200 ? 202 : 200).json(result);
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
      projection: result.projection,
    });
  }

  /** POST /api/projects/:projectId/scene-cards/:sceneCardId/storyboard-preview
   *  User 从 SceneCard 显式触发分镜预览（CONTEXT L43-47，可选旁路）：建 type=image 的 GenerationJob，
   *  其 N 个 output_slot 即有序画格。与 Dock 图片链路一致：Bearer <sk-token> 做额度预检与凭证密封。 */
  @Post("storyboard-preview")
  async storyboardPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("sceneCardId") sceneCardId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("authorization") authorization: string | undefined,
    @Res() res: Response,
  ) {
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : undefined;
    const internal = sealProviderCredential(authorization);
    const quotaCheck = token?.startsWith("sk-")
      ? async () => {
          const usage = await this.account.getTokenUsage(token);
          return { sufficient: usage.userQuota > 0 };
        }
      : undefined;

    const result = await handleStoryboardPreviewCreate(
      user.userId,
      projectId,
      sceneCardId,
      idempotencyKey ?? null,
      bodyString(body),
      this.storyboard.repo,
      {
        ...(internal.providerCredential
          ? { providerCredential: internal.providerCredential }
          : {}),
        ...(quotaCheck ? { quotaCheck } : {}),
        ...(this.cost.estimator
          ? { costEstimator: this.cost.estimator }
          : {}),
      },
    );

    // 成功后即时调度首图 job（IKBGKA：走 RocketMQ 图片 consumer，消费端 Semaphore 控并发；
    // 孤儿由 image-recovery 恢复扫描兜底）。
    if (result.code === 200 && result.data?.generation_job_id != null) {
      void enqueueImageGenerationJob(
        String(result.data.generation_job_id),
      ).catch((e) =>
        logger.error(
          `[storyboard-preview] enqueue image job failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }

    // 对齐原 web 路由：成功受理（含 job）返 202 Accepted，业务错误返 200 + 信封。
    res.status(result.code === 200 ? 202 : 200).json(result);
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
