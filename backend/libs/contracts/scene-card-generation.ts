import { z } from "zod";

import {
  capabilitySnapshotVersionSchema,
  frozenGenerationParametersSchema,
  providerPromptAssetSchema,
  type ProviderPromptAsset,
} from "./plan-message.js";
import {
  sceneCardGenerationRecordStatusSchema,
  videoReferenceModeSchema,
  type VideoReferenceMode,
} from "./plan-application.js";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

export function validateVideoReferenceConfiguration(
  referenceMode: VideoReferenceMode,
  assets: ProviderPromptAsset[],
): string | null {
  const firstFrameCount = assets.filter(
    (asset) => asset.role === "first_frame",
  ).length;
  const lastFrameCount = assets.filter(
    (asset) => asset.role === "last_frame",
  ).length;
  if (firstFrameCount > 1) return "首帧参考素材最多只能有一个";
  if (lastFrameCount > 1) return "尾帧参考素材最多只能有一个";

  const referenceCount = assets.filter(
    (asset) => asset.role === "reference",
  ).length;
  if (lastFrameCount > 0 && firstFrameCount === 0)
    return "尾帧必须与首帧一起使用";
  if ((firstFrameCount > 0 || lastFrameCount > 0) && referenceCount > 0)
    return "首尾帧模式不能与普通参考素材混用";

  const sceneCardFrame = assets.find(
    (asset) => asset.type === "scene_card" && asset.role !== "reference",
  );
  if (sceneCardFrame) return "场景卡素材不能作为首帧/尾帧";

  const derivedMode = deriveVideoReferenceMode(assets);
  if (referenceMode !== derivedMode)
    return `reference_mode ${referenceMode} 与素材角色派生模式 ${derivedMode} 不一致`;
  return null;
}

export function deriveVideoReferenceMode(
  assets: ReadonlyArray<Pick<ProviderPromptAsset, "role">>,
): VideoReferenceMode {
  const hasFirstFrame = assets.some((asset) => asset.role === "first_frame");
  const hasLastFrame = assets.some((asset) => asset.role === "last_frame");
  if (hasFirstFrame && hasLastFrame) return "first_and_last_frame";
  if (hasFirstFrame) return "first_frame";
  if (hasLastFrame) return "last_frame";
  return "text_to_video";
}

export function referenceModeToRequiredFeature(
  mode: VideoReferenceMode,
): "first_frame" | "last_frame" | "first_last_frame" | null {
  switch (mode) {
    case "first_frame":
      return "first_frame";
    case "last_frame":
      return "last_frame";
    case "first_and_last_frame":
      return "first_last_frame";
    default:
      return null;
  }
}

export const sceneCardRegenerationRequestSchema = z
  .object({
    scene_card_id: decimalIdSchema,
    base_scene_card_version: z.number().int().positive(),
    base_preset_version: z.number().int().positive(),
    parameters: frozenGenerationParametersSchema,
    reference_mode: videoReferenceModeSchema,
    reference_assets: z.array(providerPromptAssetSchema),
    capability_snapshot_version: capabilitySnapshotVersionSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.parameters.capability_type !== "video") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SceneCard 再生成媒体类型固定为视频",
      });
    }
    if (value.parameters.duration == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "视频再生成必有时长",
      });
    }
    if (
      value.parameters.capability_type !==
        value.capability_snapshot_version.capability_type ||
      value.parameters.model_id !==
        value.capability_snapshot_version.model_id ||
      value.parameters.provider_id !==
        value.capability_snapshot_version.provider_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "parameters 与冻结能力快照的 capability_type/model_id/provider_id 必须一致",
        path: ["capability_snapshot_version"],
      });
    }
    const referenceReason = validateVideoReferenceConfiguration(
      value.reference_mode,
      value.reference_assets,
    );
    if (referenceReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: referenceReason,
        path: ["reference_assets"],
      });
    }
  });

export const sceneCardGenerationRecordViewSchema = z
  .object({
    record_id: decimalIdSchema,
    scene_card_id: decimalIdSchema,
    summary_status: sceneCardGenerationRecordStatusSchema,
    first_generation_job_id: decimalIdSchema,
  })
  .strict();

export type SceneCardRegenerationRequest = z.infer<
  typeof sceneCardRegenerationRequestSchema
>;
export type SceneCardGenerationRecordView = z.infer<
  typeof sceneCardGenerationRecordViewSchema
>;
