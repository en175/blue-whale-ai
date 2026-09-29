import { z } from "zod";

import {
  assetContextProjectionSchema,
  sceneCardContextProjectionSchema,
} from "./context-projection.js";

// IKCKOW / IKD806 退役了内嵌 Agent 运行时与计划应用写路径；本文件里服务那条通道的符号
// （PlanMessage / PlanCardCandidate / PlanApplyImageReceipt / ProviderPromptProjection /
// deriveProviderPromptProjection / PlanApplicationAvailability 等）已随之删除。
// 留下的四项都是被别处真实消费的：能力快照（scene-card-generation / storyboard-preview）、
// 派生引用（validateDerivedReferences）、冻结生成参数与 ProviderPromptAsset
// （SceneCardGenerationPreset 的首/尾帧角色投影，含 storyboard_frame 画格变体）。

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** 能力快照版本（契约 §9）：generation_model_capability 无全局版本号，
 *  用 row.version + 内容 digest 兜底，schema_version 固定 1。
 *  冻结时记录所用能力的类型 / 模型 / 供应商 / 行版本与 digest，应用前用于检测能力漂移。 */
export const capabilitySnapshotVersionSchema = z
  .object({
    schema_version: z.literal(1),
    capability_type: z.enum(["image", "video"]),
    model_id: z.string().min(1),
    provider_id: z.string().min(1),
    row_version: z.number().int().nonnegative(),
    digest: digestSchema,
  })
  .strict();

/** 派生素材引用（契约 §9）：content_markdown 中 `asset://<mention_id>` 按首次出现顺序
 *  解析、去重后的稳定引用列表。projection 复用 MentionInputSnapshot 冻结的受限投影。 */
const assetDerivedReferenceSchema = z
  .object({
    mention_id: decimalIdSchema,
    mention_seq: z.number().int().nonnegative(),
    type: z.literal("asset"),
    first_seen_offset: z.number().int().nonnegative(),
    projection: assetContextProjectionSchema,
  })
  .strict();

const sceneCardDerivedReferenceSchema = z
  .object({
    mention_id: decimalIdSchema,
    mention_seq: z.number().int().nonnegative(),
    type: z.literal("scene_card"),
    first_seen_offset: z.number().int().nonnegative(),
    projection: sceneCardContextProjectionSchema,
  })
  .strict();

export const derivedReferenceSchema = z.discriminatedUnion("type", [
  assetDerivedReferenceSchema,
  sceneCardDerivedReferenceSchema,
]);

/** 冻结生成参数（契约 §9）：来自版本化能力快照的完整可执行参数集（overrides + 能力 defaults）。
 *  首次应用直接使用，不在应用时重新猜测默认值；count 为该场景结果版本数，默认 1。 */
export const frozenGenerationParametersSchema = z
  .object({
    capability_type: z.enum(["image", "video"]),
    model_id: z.string().min(1),
    provider_id: z.string().min(1),
    size: z.string().min(1),
    aspect_ratio: z.string().min(1),
    format: z.string().min(1).nullable(),
    duration: z.number().int().positive().nullable(),
    count: z.number().int().positive(),
  })
  .strict();

/** ProviderPromptProjection 中单个引用素材：身份 + 角色 + 冻结时的受限投影。
 *  抽到 export 供 SceneCardGenerationPreset（plan-application）复用首/尾帧角色投影。 */
export const providerPromptAssetSchema = z.discriminatedUnion("type", [
  z
    .object({
      mention_id: decimalIdSchema,
      type: z.literal("asset"),
      role: z.enum(["first_frame", "last_frame", "reference"]),
      projection: assetContextProjectionSchema,
    })
    .strict(),
  z
    .object({
      mention_id: decimalIdSchema,
      type: z.literal("scene_card"),
      role: z.enum(["first_frame", "last_frame", "reference"]),
      projection: sceneCardContextProjectionSchema,
    })
    .strict(),
  // 画格变体（IK70LQ，CONTEXT L53-57）：StoryboardPreview 的 succeeded 画格作为视频首/尾帧/参考图。
  // slot_id = generation_output_slots.id（画格稳定身份），服务端解析为 asset_id 写入 job.input 扁平字段。
  // 不复用 type:"asset"——画格无 PlanMessage mention_id，复用会破坏 mention 语义且通不过 validateDerivedReferences。
  // 画格不冻结 projection（投影由列表查询取 assets.url），不参与 deriveProviderPromptProjection（用户显式追加）。
  z
    .object({
      slot_id: decimalIdSchema,
      type: z.literal("storyboard_frame"),
      role: z.enum(["first_frame", "last_frame", "reference"]),
    })
    .strict(),
]);

export type CapabilitySnapshotVersion = z.infer<
  typeof capabilitySnapshotVersionSchema
>;
export type DerivedReference = z.infer<typeof derivedReferenceSchema>;
export type FrozenGenerationParameters = z.infer<
  typeof frozenGenerationParametersSchema
>;
export type ProviderPromptAsset = z.infer<typeof providerPromptAssetSchema>;
