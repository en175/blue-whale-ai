import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const stableIdSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const opaqueIdentitySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

export const runtimeResourceSchema = z
  .object({
    resource_id: stableIdSchema,
    resource_version: z.string().min(1),
    kind: z.enum(["role", "rule", "runtime_skill"]),
    load_mode: z.enum(["always_on", "on_demand"]),
    media_type: z.string().min(1),
    content: z.string().min(1),
    content_digest: digestSchema,
  })
  .strict();

export const modelProfileSchema = z
  .object({
    model_profile_id: stableIdSchema,
    provider: stableIdSchema,
    model: z.string().min(1),
    context_window_tokens: z.number().int().positive(),
    tokenizer: z.string().min(1),
  })
  .strict();

export const runtimeBudgetPolicySchema = z
  .object({
    max_provider_calls: z.number().int().positive(),
    max_input_characters: z.number().int().positive(),
    max_output_characters: z.number().int().positive(),
    protocol_repair_attempts: z.number().int().nonnegative(),
  })
  .strict();

export const toolGrantSchema = z
  .object({
    tool_id: stableIdSchema,
    registry_version: z.number().int().positive(),
  })
  .strict();

export const agentRuntimeManifestSchema = z
  .object({
    schema_version: z.literal(1),
    manifest_id: stableIdSchema,
    manifest_version: z.string().min(1),
    manifest_digest: digestSchema,
    resources: z.array(runtimeResourceSchema).min(1),
    role_resource_id: stableIdSchema,
    rule_resource_ids: z.array(stableIdSchema),
    runtime_skill_resource_ids: z.array(stableIdSchema),
    model_profiles: z.array(modelProfileSchema).min(1),
    selected_model_profile_id: stableIdSchema,
    runtime_budget_policy: runtimeBudgetPolicySchema,
    tool_grants: z.array(toolGrantSchema),
  })
  .strict();

export const autoCreativeSkillCandidateSchema = z
  .object({
    creative_skill_id: stableIdSchema,
    creative_skill_version_id: opaqueIdentitySchema,
    name: z.string().min(1),
    description: z.string().nullable(),
    display_version: z.string().min(1),
    resource_digest: digestSchema,
  })
  .strict();

const creativeSkillActivationBase = z.object({
  creative_skill_id: stableIdSchema,
  creative_skill_version_id: opaqueIdentitySchema,
  name: z.string().min(1),
  display_version: z.string().min(1),
  resource_digest: digestSchema,
});

const autoMatchReasonSchema = z
  .object({
    type: z.literal("agent_match"),
    detail: z
      .object({
        matched_fields: z
          .array(
            z.enum([
              "conversation_messages",
              "conversation_summary",
              "canvas_nodes",
              "project_metadata",
            ]),
          )
          .min(1)
          .refine((fields) => new Set(fields).size === fields.length),
      })
      .strict(),
  })
  .strict();

const forcedCreativeSkillActivationSchema = creativeSkillActivationBase
  .extend({
    source: z.literal("forced_use"),
    reason: z.object({ type: z.literal("user_use") }).strict(),
  })
  .strict();

export const autoCreativeSkillActivationSchema = creativeSkillActivationBase
  .extend({
    source: z.literal("auto"),
    reason: autoMatchReasonSchema,
  })
  .strict();

export const creativeSkillActivationSchema = z.discriminatedUnion("source", [
  forcedCreativeSkillActivationSchema,
  autoCreativeSkillActivationSchema,
]);

export const creativeSkillResourceSchema = autoCreativeSkillCandidateSchema
  .extend({
    media_type: z.literal("text/markdown"),
    body: z.string().min(1),
    content_digest: digestSchema,
  })
  .strict();

export const agentRunPinSchema = z
  .object({
    schema_version: z.literal(1),
    manifest_id: stableIdSchema,
    manifest_version: z.string().min(1),
    manifest_digest: digestSchema,
    pin_digest: digestSchema,
    resources: z.array(runtimeResourceSchema).min(1),
    role_resource_id: stableIdSchema,
    rule_resource_ids: z.array(stableIdSchema),
    runtime_skill_resource_ids: z.array(stableIdSchema),
    model_profile: modelProfileSchema,
    runtime_budget_policy: runtimeBudgetPolicySchema,
    tool_grants: z.array(toolGrantSchema),
    auto_creative_skill_candidates: z.array(autoCreativeSkillCandidateSchema),
    activated_creative_skill_versions: z
      .array(creativeSkillActivationSchema)
      .max(1),
    creative_skill_resources: z.array(creativeSkillResourceSchema),
  })
  .strict();

export const agentRunStageSchema = z.enum([
  "understanding",
  "alignment",
  "awaiting_final_confirmation",
  "completed",
  "cancelled",
]);

/** 临时交付状态（契约 §8.1）：streaming 只在短期投影，RunCommit 才提升为正式消息。 */
export const agentProvisionalDeliveryStatusSchema = z.enum([
  "streaming",
  "completed",
  "interrupted",
]);

export const agentProvisionalInterruptionReasonSchema = z.enum([
  "user_cancelled",
  "failed",
]);

/** 供应商调用记录状态（契约 §8.4）：接管重放与成本事实的权威。 */
export const agentProviderCallStatusSchema = z.enum([
  "in_flight",
  "succeeded",
  "failed_definitive",
  "outcome_unknown",
]);

/** AgentRun 终态原因（契约 §8.6）：区分用户停止与运行时错误。 */
export const agentRunTerminalReasonSchema = z.enum([
  "user_requested",
  "runtime_error",
]);

export const agentRunPublicProjectionSchema = z
  .object({
    agent_run_id: decimalIdSchema,
    status: z.enum([
      "queued",
      "running",
      "awaiting_input",
      "awaiting_job",
      "completed",
      "failed",
      "cancelled",
      "recovery_failed",
    ]),
    stage: agentRunStageSchema.nullable(),
    version: z.number().int().nonnegative(),
    terminal_reason: agentRunTerminalReasonSchema.nullable().default(null),
    failure_code: stableIdSchema.nullable().default(null),
    retry_count: z.number().int().nonnegative().default(0),
    activated_creative_skill_versions: z
      .array(creativeSkillActivationSchema)
      .max(1),
    reasoning_summary: z.string().min(1).max(280).nullable(),
  })
  .strict();

const agentInputMessageSchema = z
  .object({
    message_id: decimalIdSchema,
    sequence_no: z.number().int().positive(),
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
  })
  .strict();

const agentHistoryMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
  })
  .strict();

/** Mention 可用性失败原因（对齐 core MentionFailureReason）：契约层独立定义，
 *  MentionInputSnapshot 冻结时与 availability 一起写入。 */
const mentionFailureReasonSchema = z.enum([
  "deleted",
  "stale",
  "permission_lost",
  "wrong_project",
]);

/** 资产受限投影（T08，IK67H3）：复用 T04 mention 接纳冻结的字段集，
 *  **不含 storage_key / url / user_id** —— Agent 只拿到产品投影 + 临时访问能力。 */
export const assetContextProjectionSchema = z
  .object({
    asset_type: z.string().min(1),
    mime: z.string().nullable(),
    size: z.string().regex(/^[0-9]+$/).nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    duration_ms: z.number().int().nullable(),
    content_sha256: z.string().nullable(),
  })
  .strict();

/** 场景卡片受限投影（T08）：title/summary/content_markdown/version。 */
export const sceneCardContextProjectionSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().nullable(),
    content_markdown: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict();

/** 单条 mention 的输入快照条目：mention 身份 + 当前可用性 + 受限投影。
 *  projection 为可选字段；冻结路径（claimNext 事务）对 unavailable 条目不写
 *  projection，不暴露内容——schema 不强制该组合，生产者只有冻结路径。 */
export const mentionInputEntrySchema = z
  .object({
    mention_id: decimalIdSchema,
    mention_seq: z.number().int().nonnegative(),
    type: z.enum(["asset", "scene_card"]),
    availability: z.enum(["available", "stale", "unavailable"]),
    reason: mentionFailureReasonSchema.nullable(),
    projection: z
      .union([assetContextProjectionSchema, sceneCardContextProjectionSchema])
      .optional(),
  })
  .strict();

/** MentionInputSnapshot（T08，IK67H3）：每次 AgentAdvance 冻结的本轮显式引用快照。
 *  与 mention 事实同事务边界冻结（claimNext 内），接管复用，后续消息/Canvas 不改写。
 *  entries 的 availability 是冻结时点的记录，也用于过滤模型输入投影；硬权限闸门
 *  在供应商调用/结果复用/RunCommit 前按**当前事实**重查授权（AC#5），不读冻结值。 */
export const mentionInputSnapshotSchema = z
  .object({
    capability_snapshot_version: z.literal(1),
    entries: z.array(mentionInputEntrySchema),
  })
  .strict();

export const agentRunWorkSchema = z
  .object({
    schema_version: z.literal(1),
    agent_run_id: decimalIdSchema,
    advance_id: decimalIdSchema,
    fencing_token: decimalIdSchema,
    run_version: z.number().int().nonnegative(),
    input_high_watermark_sequence_no: z.number().int().positive(),
    input_messages: z.array(agentInputMessageSchema).min(1),
    history_messages: z.array(agentHistoryMessageSchema).default([]),
    prompt: z.string().min(1),
    run_pin: agentRunPinSchema,
    auto_creative_skill_candidates: z.array(autoCreativeSkillCandidateSchema),
    activated_creative_skill_versions: z
      .array(creativeSkillActivationSchema)
      .max(1),
    mention_input_snapshot: mentionInputSnapshotSchema,
  })
  .strict();

const runCommitBase = z.object({
  schema_version: z.literal(1),
  advance_id: decimalIdSchema,
  fencing_token: decimalIdSchema,
  expected_run_version: z.number().int().nonnegative(),
  request_digest: digestSchema,
});

export const awaitingInputStageSchema = z.enum([
  "alignment",
  "awaiting_final_confirmation",
]);

export const agentRunCommitSchema = z.discriminatedUnion("outcome", [
  runCommitBase
    .extend({
      outcome: z.literal("completed"),
      assistant_message: z.object({ content: z.string().min(1) }).strict(),
      reasoning_summary: z.string().min(1).max(280),
      auto_creative_skill_activation:
        autoCreativeSkillActivationSchema.nullable(),
    })
    .strict(),
  runCommitBase
    .extend({
      outcome: z.literal("failed"),
      failure: z
        .object({
          code: stableIdSchema,
          message: z.string().min(1).max(1000),
        })
        .strict(),
    })
    .strict(),
  runCommitBase
    .extend({
      outcome: z.literal("awaiting_input"),
      assistant_message: z.object({ content: z.string().min(1) }).strict(),
      reasoning_summary: z.string().min(1).max(280),
      input_request: z
        .object({ question: z.string().min(1).max(2000) })
        .strict(),
      stage: awaitingInputStageSchema,
    })
    .strict(),
  runCommitBase
    .extend({
      outcome: z.literal("cancelled"),
    })
    .strict(),
]);

export type AgentRuntimeManifest = z.infer<typeof agentRuntimeManifestSchema>;
export type AgentRunPin = z.infer<typeof agentRunPinSchema>;
export type AutoCreativeSkillCandidate = z.infer<
  typeof autoCreativeSkillCandidateSchema
>;
export type AutoCreativeSkillActivation = z.infer<
  typeof autoCreativeSkillActivationSchema
>;
export type CreativeSkillActivation = z.infer<
  typeof creativeSkillActivationSchema
>;
export type CreativeSkillResource = z.infer<typeof creativeSkillResourceSchema>;
export type AgentRunPublicProjection = z.infer<
  typeof agentRunPublicProjectionSchema
>;
export type AgentRunStage = z.infer<typeof agentRunStageSchema>;
export type AgentProvisionalDeliveryStatus = z.infer<
  typeof agentProvisionalDeliveryStatusSchema
>;
export type AgentProvisionalInterruptionReason = z.infer<
  typeof agentProvisionalInterruptionReasonSchema
>;
export type AgentProviderCallStatus = z.infer<
  typeof agentProviderCallStatusSchema
>;
export type AgentRunTerminalReason = z.infer<typeof agentRunTerminalReasonSchema>;
export type AgentRunWork = z.infer<typeof agentRunWorkSchema>;
export type AgentHistoryMessage = AgentRunWork["history_messages"][number];
export type AssetContextProjection = z.infer<
  typeof assetContextProjectionSchema
>;
export type SceneCardContextProjection = z.infer<
  typeof sceneCardContextProjectionSchema
>;
export type MentionInputEntry = z.infer<typeof mentionInputEntrySchema>;
export type MentionInputSnapshot = z.infer<typeof mentionInputSnapshotSchema>;
export type MentionAvailability = MentionInputEntry["availability"];
export type MentionFailureReason = z.infer<typeof mentionFailureReasonSchema>;
export type AgentRunCommit = z.infer<typeof agentRunCommitSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** RunPin 私有完整性摘要的唯一规范化输入；哈希由 Node 边界负责。 */
export function canonicalAgentRunPinDigestInput(
  pin: Omit<AgentRunPin, "pin_digest">,
): string {
  return JSON.stringify(canonicalize(pin));
}
