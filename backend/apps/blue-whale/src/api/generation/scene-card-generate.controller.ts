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
import { isRecoveryControlledEnvelope } from "../recovery-envelope.js";

function bodyString(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body ?? "");
}

@Controller("projects/:projectId/scene-cards/:sceneCardId")
export class SceneCardGenerateController {
  constructor(
    private readonly sceneCard: SceneCardGenerationService,
    private readonly storyboard: StoryboardPreviewService,
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
        const log = enqueueFailureLog(error, { scope: "scene-card-generate", kind: "video", jobId });
        logger[log.level](log.message);
      }
    }
    this.writeAcceptedOrThrow(result, res);
  }

  private writeAcceptedOrThrow(
    result: ResultEnvelope<unknown>,
    res: Response,
  ): void {
    if (result.code !== 200) {
      throw new DomainError(result.code, result.msg ?? undefined);
    }
    res.status(202).json(result);
  }

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

    if (result.code === 200 && result.data?.generation_job_id != null) {
      const jobId = String(result.data.generation_job_id);
      void enqueueImageGenerationJob(jobId).catch((e) => {
        const log = enqueueFailureLog(e, { scope: "storyboard-preview", kind: "image", jobId });
        logger[log.level](log.message);
      });
    }

    if (isRecoveryControlledEnvelope(result)) {
      res.status(result.code).json(result);
      return;
    }
    this.writeAcceptedOrThrow(result, res);
  }

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
