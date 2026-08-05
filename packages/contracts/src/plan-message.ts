import { z } from "zod";

import {
  assetContextProjectionSchema,
  sceneCardContextProjectionSchema,
} from "./context-projection.js";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** PlanApplicationKind（契约 §9 / CONTEXT）：PlanMessage、PlanApplicationReceipt 与应用事件
 *  共享的应用类型判别字段。
 *  - image_generate：直接生成图片，不创建 SceneCard；
 *  - scene_card_create：新建 SceneCard 并生成视频；
 *  - scene_card_replace：覆盖本轮唯一可用 SceneCardMention 并生成视频，必须独占单卡提交。 */
export const planApplicationKindSchema = z.enum([
  "image_generate",
  "scene_card_create",
  "scene_card_replace",
]);

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

/** write_plan_cards 入参中的参数覆盖（契约 §9）：User/Agent 明确指定的值；
 *  未指定项由能力默认补齐，禁虚构能力或静默降级。首/尾帧由 mention_seq 指定，仅视频有意义。 */
export const planGenerationParameterOverridesSchema = z
  .object({
    size: z.string().min(1).optional(),
    aspect_ratio: z.string().min(1).optional(),
    format: z.string().min(1).nullable().optional(),
    duration: z.number().int().positive().nullable().optional(),
    count: z.number().int().positive().optional(),
    first_frame_mention_seq: z.number().int().nonnegative().nullable().optional(),
    last_frame_mention_seq: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

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
]);

/** ProviderPromptProjection（契约 §9，AC#7）：由权威 Markdown 确定性派生的供应商提示词投影。
 *  prompt_text === content_markdown 原文（不改写、不调第二模型）；
 *  reference_assets 按首次出现顺序，role 由首/尾帧 mention_seq 反查，未指定即为 reference；
 *  parameters 为冻结生成参数原样透传。 */
export const providerPromptProjectionSchema = z
  .object({
    prompt_text: z.string().min(1),
    reference_assets: z.array(providerPromptAssetSchema),
    parameters: frozenGenerationParametersSchema,
  })
  .strict();

/** write_plan_cards 单卡候选入参（契约 §9）：判别联合强制 scene_card_replace 必填
 *  target_scene_card_mention_id（本轮 available SceneCardMention 句柄），且独占单卡提交；
 *  非 replace 不得携带 target 字段（strict 拒绝未知键）。
 *  Agent 不自行填写 SceneCard 身份或版本——base_scene_card_version 由 Product API 在
 *  RunCommit 接纳时从 mention.target_version 解析并冻结（CONTEXT PlanMessage 权威约束）。 */
const planCardCandidateCommon = z.object({
  title: z.string().min(1).max(255),
  summary: z.string().min(1).nullable().optional(),
  content_markdown: z.string().min(1),
  parameter_overrides: planGenerationParameterOverridesSchema.optional(),
  sequence_label_noun: z.string().min(1).max(255).optional(),
  base_plan_message_id: decimalIdSchema.optional(),
  source_plan_message_id: decimalIdSchema.optional(),
});

export const planCardCandidateSchema = z.discriminatedUnion("application_kind", [
  planCardCandidateCommon
    .extend({ application_kind: z.literal("image_generate") })
    .strict(),
  planCardCandidateCommon
    .extend({ application_kind: z.literal("scene_card_create") })
    .strict(),
  planCardCandidateCommon
    .extend({
      application_kind: z.literal("scene_card_replace"),
      target_scene_card_mention_id: decimalIdSchema,
    })
    .strict(),
]);

/** PlanMessage 冻结后不可变形态（契约 §9）：RunCommit 原子接纳后的权威快照。
 *  replace 的 target 字段非空由提交期校验保证；此处 nullable 以匹配存储形态。 */
export const planMessageSchema = z
  .object({
    message_id: decimalIdSchema,
    conversation_id: decimalIdSchema,
    ordinal: z.number().int().positive(),
    total_in_batch: z.number().int().positive(),
    sequence_label: z.string().min(1).max(255).nullable(),
    application_kind: planApplicationKindSchema,
    target_scene_card_mention_id: decimalIdSchema.nullable(),
    base_scene_card_version: z.number().int().positive().nullable(),
    content_markdown: z.string().min(1),
    derived_references: z.array(derivedReferenceSchema),
    frozen_generation_parameters: frozenGenerationParametersSchema,
    capability_snapshot_version: capabilitySnapshotVersionSchema,
    provider_prompt_projection: providerPromptProjectionSchema,
    base_plan_message_id: decimalIdSchema.nullable(),
    source_plan_message_id: decimalIdSchema.nullable(),
  })
  .strict();

export type PlanApplicationKind = z.infer<typeof planApplicationKindSchema>;
export type CapabilitySnapshotVersion = z.infer<
  typeof capabilitySnapshotVersionSchema
>;
export type DerivedReference = z.infer<typeof derivedReferenceSchema>;
export type PlanGenerationParameterOverrides = z.infer<
  typeof planGenerationParameterOverridesSchema
>;
export type FrozenGenerationParameters = z.infer<
  typeof frozenGenerationParametersSchema
>;
export type ProviderPromptAsset = z.infer<typeof providerPromptAssetSchema>;
export type ProviderPromptProjection = z.infer<
  typeof providerPromptProjectionSchema
>;
export type PlanCardCandidate = z.infer<typeof planCardCandidateSchema>;
export type PlanMessage = z.infer<typeof planMessageSchema>;

/** PlanMessage 应用可用性（契约 §9 / T10）：把素材可用性 + 能力漂移 + 余额状态收敛为
 *  对前端单一可渲染的三态。
 *  - available：可立即应用；
 *  - retryable_blocked：余额不足或能力瞬时不可用——用户充值/恢复后用新 CommandId 重试；
 *  - requires_new_plan：素材失效（deleted/wrong_project/permission_lost）或能力永久下线
 *    （冻结后能力被删/禁用）——必须重新对话生成新计划。 */
export const planApplicationAvailabilitySchema = z.enum([
  "available",
  "retryable_blocked",
  "requires_new_plan",
]);

/** PlanApplicationReceipt 通用字段（契约 §9 / T10）：媒体感知判别联合的公共部分。
 *  applied_at 为首次成功应用的 ISO 时间戳（at-most-once：换 CommandId 重放也回首次回执）。 */
const planApplicationReceiptCommon = {
  receipt_id: decimalIdSchema,
  plan_message_id: decimalIdSchema,
  project_id: decimalIdSchema,
  conversation_id: decimalIdSchema,
  agent_run_id: decimalIdSchema,
  first_generation_job_id: decimalIdSchema,
  /** 冻结态内容摘要（content_markdown SHA-256），便于审计比对。 */
  content_digest: digestSchema,
  /** 首次成功应用时间（ISO）。 */
  applied_at: z.string().min(1),
};

/** 图片分支（契约 §9）：直接生成图片、不创建 SceneCard，故 scene_card_id 恒为 null。 */
const planApplicationReceiptImageSchema = z
  .object({
    ...planApplicationReceiptCommon,
    application_kind: z.literal("image_generate"),
    scene_card_id: z.null(),
  })
  .strict();

/** 视频分支公共预留字段（T11/T12 本期不填，全部 nullable）：scene_card_id 为目标场景卡，
 *  result_scene_card_version 为应用后产出的场景卡版本，generation_preset_digest 为生成预设摘要。 */
const planApplicationReceiptVideoFields = {
  scene_card_id: decimalIdSchema.nullable(),
  result_scene_card_version: z.number().int().positive().nullable(),
  generation_preset_digest: digestSchema.nullable(),
};

const planApplicationReceiptCreateSchema = z
  .object({
    ...planApplicationReceiptCommon,
    ...planApplicationReceiptVideoFields,
    application_kind: z.literal("scene_card_create"),
  })
  .strict();

const planApplicationReceiptReplaceSchema = z
  .object({
    ...planApplicationReceiptCommon,
    ...planApplicationReceiptVideoFields,
    application_kind: z.literal("scene_card_replace"),
  })
  .strict();

/** PlanApplicationReceipt（契约 §9 / T10）：PlanMessage 首次成功应用的权威回执，
 *  媒体感知判别联合——图片分支 scene_card_id 恒 null，视频分支预留 scene 字段。 */
export const planApplicationReceiptSchema = z.discriminatedUnion(
  "application_kind",
  [
    planApplicationReceiptImageSchema,
    planApplicationReceiptCreateSchema,
    planApplicationReceiptReplaceSchema,
  ],
);

export type PlanApplicationAvailability = z.infer<
  typeof planApplicationAvailabilitySchema
>;
export type PlanApplicationReceipt = z.infer<
  typeof planApplicationReceiptSchema
>;

/** 确定性派生 ProviderPromptProjection（AC#7）：纯函数，不改写正文、不调用第二模型。
 *  首/尾帧由 mention_seq 指定（来自冻结的 overrides），命中即置 first_frame / last_frame，
 *  其余为 reference；parameters 原样透传冻结参数。 */
export function deriveProviderPromptProjection(input: {
  readonly content_markdown: string;
  readonly derived_references: readonly DerivedReference[];
  readonly frozen_generation_parameters: FrozenGenerationParameters;
  readonly first_frame_mention_seq?: number | null;
  readonly last_frame_mention_seq?: number | null;
}): ProviderPromptProjection {
  const firstFrame = input.first_frame_mention_seq ?? null;
  const lastFrame = input.last_frame_mention_seq ?? null;
  const resolveRole = (mentionSeq: number): ProviderPromptAsset["role"] => {
    if (firstFrame !== null && mentionSeq === firstFrame) return "first_frame";
    if (lastFrame !== null && mentionSeq === lastFrame) return "last_frame";
    return "reference";
  };
  const reference_assets: ProviderPromptAsset[] = input.derived_references.map(
    (reference) => {
      const role = resolveRole(reference.mention_seq);
      if (reference.type === "asset") {
        return {
          mention_id: reference.mention_id,
          type: "asset",
          role,
          projection: reference.projection,
        };
      }
      return {
        mention_id: reference.mention_id,
        type: "scene_card",
        role,
        projection: reference.projection,
      };
    },
  );
  return {
    prompt_text: input.content_markdown,
    reference_assets,
    parameters: input.frozen_generation_parameters,
  };
}
