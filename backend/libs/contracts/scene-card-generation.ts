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

  // 与 Dock 路径（handle-create-generation-job）同款组合规则，前置拒绝、零写入，
  // 避免先持久化再由 video-job-runner 运行时抛错（AC#4 任何副作用前拒绝）。
  const referenceCount = assets.filter(
    (asset) => asset.role === "reference",
  ).length;
  if (lastFrameCount > 0 && firstFrameCount === 0)
    return "尾帧必须与首帧一起使用";
  if ((firstFrameCount > 0 || lastFrameCount > 0) && referenceCount > 0)
    return "首尾帧模式不能与普通参考素材混用";
  // IKHBDO：此处**不再有**「参考素材最多 12 个」——契约层拿不到能力行，数量上限必须由手握
  // 能力行的那一层判定（scene-card-generation-repo.checkReferenceCountLimits，与接纳侧
  // checkReferenceLimits 同源）。写死 12 会让「配了 30 的模型」在第 13 个素材就被拦掉。

  // scene_card 类素材无 asset 映射（resolveReferenceAssetsToFlat 解析不出 asset_id），
  // 作首/尾帧会被静默丢弃、worker 按无帧生成（AC#4 不静默降级）——其内容经投影进
  // prompt，只允许 reference 角色。
  const sceneCardFrame = assets.find(
    (asset) => asset.type === "scene_card" && asset.role !== "reference",
  );
  if (sceneCardFrame) return "场景卡素材不能作为首帧/尾帧";

  const derivedMode = deriveVideoReferenceMode(assets);
  if (referenceMode !== derivedMode)
    return `reference_mode ${referenceMode} 与素材角色派生模式 ${derivedMode} 不一致`;
  return null;
}

/** 参考素材角色到视频参考模式的唯一派生规则。 */
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

/** 视频参考模式 → 它所依赖的模型能力 feature 名（snake_case）；`text_to_video` 不依赖任何
 *  feature，返回 null。集中这一映射供前端（能力错误提示、模式过滤）与后端（能力上限校验）共用，
 *  避免各处抄错——尤其反直觉点：`first_and_last_frame` 模式对应能力字段 `first_last_frame`（无 "and"）。 */
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

/** SceneCard 再生成请求（CONTEXT L49-63 / L84-89）：User 在生成编辑器中对已有 SceneCard
 *  调整参数后点"生成"提交的载荷。base 版本用于乐观并发——提交前编辑器读取的 SceneCard 与 Preset
 *  当前版本；服务端 CAS 比对，不一致零写入并返回 version_conflict 保留草稿。
 *  - parameters/reference_mode/reference_assets/capability_snapshot_version 为本次提交的新参数快照，
 *    复用 SceneCardGenerationPreset 的约束（媒体类型固定视频、必有时长）。
 *  - 媒体类型、权威 Markdown、ProviderPromptProjection 摘要由只读端点单独下发，不在本请求重复。 */
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

/** SceneCardGenerationRecord 的 Snapshot 投影（CONTEXT L82-88 / spec）：恢复权威的 generation origins/
 *  summaries 子集。完整 Preset 参数不进 Snapshot（省体积），编辑器打开时按需 GET 只读端点。
 *  - record_id：记录身份；
 *  - first_generation_job_id：该记录首个 GenerationJob（首次应用或本次再生成）。
 *  plan_message_id 随计划通道退役（来源表已 DROP），不再投影。 */
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
