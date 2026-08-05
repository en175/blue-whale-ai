import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canonicalizeJsonValue } from "@blue-whale/contracts";

import { classifyPlanApplicationAvailability } from "@blue-whale/core";
import type {
  CapabilitySnapshotVersion,
  FrozenGenerationParameters,
  PlanApplyImageReceipt,
} from "@blue-whale/contracts";

import { createJobWithinTx } from "./generation-command-repo.js";
import { capabilityDigest } from "./capability-digest.js";
import { appendProjectEvent } from "./product-event-repo.js";
import { transactionWithUniqueRetry } from "./conversation-repo.js";
import { classifyMentionAvailability } from "./mention-availability.js";
import { loadMentionTargetFacts } from "./agent-run-repo.js";

const OPERATION = "plan.message.apply";
/** 图片应用幂等操作名（与视频路径分列，避免跨媒体 CommandId 误判重放）。 */
const IMAGE_OPERATION = "plan_message.apply";

/** 计划应用 repo 入参：User 手动应用一条 PlanMessage（媒体感知分派）。
 *  idempotencyKey 即 CommandId；requestHash 由 handler 按 method/path/body 计算。
 *  图片分支额外要求 providerCredential（密封 sk token）与 quotaCheck（余额预检回调）。 */
export interface ApplyPlanMessageInput {
  userId: string;
  projectId: string;
  planMessageId: string;
  idempotencyKey: string;
  requestHash: string;
  providerCredential?: string;
  quotaCheck?: () => Promise<{ sufficient: boolean }>;
}

export type ApplyPlanMessageResult =
  // —— 视频分支（scene_card_create，T11）——
  | {
      kind: "applied";
      scene_card_id: string;
      generation_job_id: string;
      receipt_id: string;
      cursor: string;
    }
  | { kind: "replayed"; scene_card_id: string; generation_job_id: string }
  | { kind: "idempotency_conflict" }
  | { kind: "already_applied" }
  | { kind: "plan_not_found" }
  | { kind: "kind_unsupported" }
  | { kind: "capability_drift" }
  | { kind: "validation_failed"; reason: string }
  | { kind: "forbidden" }
  // —— 图片分支（image_generate，T10）——
  | {
      kind: "applied_image";
      receipt: PlanApplyImageReceipt;
      first_generation_job_id: string;
      cursor: string;
    }
  | {
      kind: "replayed_image";
      receipt: PlanApplyImageReceipt;
      first_generation_job_id: string;
      cursor: string;
    }
  | {
      kind: "already_applied_image";
      receipt: PlanApplyImageReceipt;
      first_generation_job_id: string;
    }
  | {
      kind: "blocked_requires_new_plan";
      reason: string;
      blockedBy: "mention_unavailable" | "capability_drifted";
    }
  | { kind: "blocked_retryable"; reason: string };

export interface PlanApplicationRepo {
  /** 手动应用 PlanMessage：按 application_kind 分派视频（T11）/图片（T10）事务。 */
  applyPlanMessage(input: ApplyPlanMessageInput): Promise<ApplyPlanMessageResult>;
}

interface CapabilitySnapshot {
  schema_version: number;
  capability_type: string;
  model_id: string;
  provider_id: string;
  row_version: number;
  digest: string;
}

interface DerivedReference {
  mention_id: string;
  mention_seq: number;
  type: "asset" | "scene_card";
  first_seen_offset: number;
}

interface ReferenceAsset {
  mention_id: string;
  type: "asset" | "scene_card";
  role: "first_frame" | "last_frame" | "reference";
}

type VideoReferenceMode =
  | "text_to_video"
  | "first_frame"
  | "last_frame"
  | "first_and_last_frame";

function sha256Digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deriveReferenceMode(assets: ReferenceAsset[]): VideoReferenceMode {
  const hasFirst = assets.some((asset) => asset.role === "first_frame");
  const hasLast = assets.some((asset) => asset.role === "last_frame");
  if (hasFirst && hasLast) return "first_and_last_frame";
  if (hasFirst) return "first_frame";
  if (hasLast) return "last_frame";
  return "text_to_video";
}

/** scene_cards.title 是 NOT NULL，但 plan_messages 只冻结 sequence_label（可空）与 content_markdown。
 *  title 取 sequence_label，缺失时从正文首行派生（剥离 asset:// 引用），兜底「场景卡」。 */
function sceneCardTitle(
  sequenceLabel: string | null,
  contentMarkdown: string,
): string {
  if (sequenceLabel && sequenceLabel.trim().length > 0) {
    return sequenceLabel.slice(0, 255);
  }
  const firstLine =
    contentMarkdown
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? contentMarkdown.trim();
  const cleaned = firstLine.replace(/asset:\/\/[0-9]+/g, "").trim();
  return (cleaned || "场景卡").slice(0, 255);
}

/** AC#4：应用前重新验证冻结素材（CONTEXT L223）。derived_reference.mention_id 指向
 *  conversation_message_mentions.id，其 target_id 指向 asset/scene_card；任一目标被删/失效则零写入。 */
async function validateDerivedReferences(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  derivedReferences: DerivedReference[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (derivedReferences.length === 0) return { ok: true };

  const assetMentionIds = derivedReferences
    .filter((reference) => reference.type === "asset")
    .map((reference) => BigInt(reference.mention_id));
  const sceneCardMentionIds = derivedReferences
    .filter((reference) => reference.type === "scene_card")
    .map((reference) => BigInt(reference.mention_id));

  if (assetMentionIds.length > 0) {
    const mentions = await tx.conversation_message_mentions.findMany({
      where: { id: { in: assetMentionIds } },
      select: { id: true, target_id: true, project_id: true },
    });
    const mentionByHandle = new Map(mentions.map((mention) => [mention.id, mention]));
    const assetIds = mentions.map((mention) => mention.target_id);
    const assets =
      assetIds.length === 0
        ? []
        : await tx.assets.findMany({
            where: { id: { in: assetIds } },
            select: { id: true, project_id: true, status: true, is_delete: true },
          });
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    for (const reference of derivedReferences.filter((r) => r.type === "asset")) {
      const mention = mentionByHandle.get(BigInt(reference.mention_id));
      if (!mention) return { ok: false, reason: `mention ${reference.mention_id} not found` };
      if (mention.project_id !== projectId)
        return { ok: false, reason: `mention ${reference.mention_id} wrong project` };
      const asset = assetById.get(mention.target_id);
      if (!asset || asset.is_delete || asset.status !== "normal")
        return { ok: false, reason: `asset for mention ${reference.mention_id} unavailable` };
      if (asset.project_id !== projectId)
        return { ok: false, reason: `asset for mention ${reference.mention_id} wrong project` };
    }
  }

  if (sceneCardMentionIds.length > 0) {
    const mentions = await tx.conversation_message_mentions.findMany({
      where: { id: { in: sceneCardMentionIds } },
      select: { id: true, target_id: true, project_id: true },
    });
    const mentionByHandle = new Map(mentions.map((mention) => [mention.id, mention]));
    const sceneCardIds = mentions.map((mention) => mention.target_id);
    const sceneCards =
      sceneCardIds.length === 0
        ? []
        : await tx.scene_cards.findMany({
            where: { id: { in: sceneCardIds } },
            select: { id: true, project_id: true, is_delete: true },
          });
    const sceneCardById = new Map(sceneCards.map((card) => [card.id, card]));
    for (const reference of derivedReferences.filter((r) => r.type === "scene_card")) {
      const mention = mentionByHandle.get(BigInt(reference.mention_id));
      if (!mention) return { ok: false, reason: `mention ${reference.mention_id} not found` };
      const card = sceneCardById.get(mention.target_id);
      if (!card || card.is_delete === 1)
        return { ok: false, reason: `scene_card for mention ${reference.mention_id} unavailable` };
    }
  }

  return { ok: true };
}

/** 单事务原子应用 scene_card_create PlanMessage（AC#2/#3/#4/#6）。
 *  任一前置检查失败零写入；同 CommandId 重复返回首次结果；同消息跨 CommandId 已应用拒绝。 */
async function applySceneCardCreateInTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyPlanMessageInput,
): Promise<ApplyPlanMessageResult> {
  const projectId = BigInt(input.projectId);
  const userId = BigInt(input.userId);

  // 0. 前置授权（AC#4）：校验项目归属当前用户（对齐 conversation-repo 既有模式），不泄漏存在性。
  const project = await tx.project.findFirst({
    where: { id: projectId, owner_id: userId, is_delete: 0 },
    select: { id: true },
  });
  if (!project) return { kind: "forbidden" } as const;

  // 1. CommandId 幂等（AC#6）：命中则比对 request_hash，相同重放首次结果，不同冲突。
  const existing = await tx.command_idempotency.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: projectId,
        operation: OPERATION,
        idempotency_key: input.idempotencyKey,
      },
    },
    select: {
      request_hash: true,
      resource_id: true,
      generation_job_id: true,
    },
  });
  if (existing) {
    if (existing.request_hash !== input.requestHash)
      return { kind: "idempotency_conflict" };
    if (existing.resource_id === null || existing.generation_job_id === null)
      return { kind: "validation_failed", reason: "idempotent record missing resources" };
    return {
      kind: "replayed",
      scene_card_id: existing.resource_id.toString(),
      generation_job_id: existing.generation_job_id.toString(),
    };
  }

  // 2. 读 plan_messages（不可变，无 is_delete），校验项目归属 + application_kind。
  const planMessage = await tx.plan_messages.findUnique({
    where: { message_id: BigInt(input.planMessageId) },
  });
  if (!planMessage || planMessage.project_id !== projectId)
    return { kind: "plan_not_found" };
  if (planMessage.application_kind !== "scene_card_create")
    return { kind: "kind_unsupported" };

  // CONTEXT L227：每条 PlanMessage 最多一次成功应用；成功后不同 CommandId 也不得再次应用。
  const priorReceipt = await tx.plan_application_receipts.findUnique({
    where: { message_id: planMessage.message_id },
    select: { id: true },
  });
  if (priorReceipt) return { kind: "already_applied" };

  const snapshot = planMessage.capability_snapshot_version as unknown as CapabilitySnapshot;
  const frozenParameters = planMessage.frozen_generation_parameters as unknown as Record<string, unknown>;
  const projection = planMessage.provider_prompt_projection as unknown as {
    prompt_text: string;
    reference_assets: ReferenceAsset[];
    parameters: Record<string, unknown>;
  };
  const derivedReferences = (planMessage.derived_references as unknown as DerivedReference[]) ?? [];

  // 3. 能力漂移检测（AC#4）：按冻结 model_id/provider_id 查当前行，比对 row_version + digest。
  const capability = await tx.generation_model_capability.findUnique({
    where: {
      provider_id_model_id: {
        provider_id: snapshot.provider_id,
        model_id: snapshot.model_id,
      },
    },
    select: {
      version: true,
      enabled: true,
      is_delete: true,
      supported_sizes: true,
      supported_aspect_ratios: true,
      supported_durations: true,
      supported_formats: true,
      default_size: true,
      default_format: true,
      default_aspect_ratio: true,
      default_duration: true,
    },
  });
  if (!capability || !capability.enabled || capability.is_delete)
    return { kind: "capability_drift" };
  const recomputedDigest = capabilityDigest({
    supported_sizes: capability.supported_sizes,
    supported_aspect_ratios: capability.supported_aspect_ratios,
    supported_durations: capability.supported_durations,
    supported_formats: capability.supported_formats,
    default_size: capability.default_size,
    default_format: capability.default_format,
    default_aspect_ratio: capability.default_aspect_ratio,
    default_duration: capability.default_duration,
  });
  if (capability.version !== snapshot.row_version || recomputedDigest !== snapshot.digest)
    return { kind: "capability_drift" };

  // 4. 引用素材有效性（AC#4，全部在副作用前）。
  const referenceCheck = await validateDerivedReferences(tx, projectId, derivedReferences);
  if (!referenceCheck.ok) return { kind: "validation_failed", reason: referenceCheck.reason };

  // === 前置检查全部通过，开始原子创建五条产品事实（AC#2/#3）===

  // 5. INSERT scene_cards（version=1，权威正文来自 plan_message.content_markdown）。
  const sceneCard = await tx.scene_cards.create({
    data: {
      project_id: projectId,
      title: sceneCardTitle(planMessage.sequence_label, planMessage.content_markdown),
      summary: null,
      content_markdown: planMessage.content_markdown,
      version: 1,
    },
  });
  const sceneCardId = sceneCard.id;

  // 6. 创建首个视频 GenerationJob（source=plan），复用 createJobWithinTx 组合进本事务。
  const referenceMode = deriveReferenceMode(projection.reference_assets);
  const createdJob = await createJobWithinTx(tx, {
    projectId: input.projectId,
    userId: input.userId,
    type: "video",
    expectedOutputCount: Number(frozenParameters.count ?? 1),
    source: "plan",
    actionIdentity: input.idempotencyKey,
    actionType: "plan.video_generation",
    input: {
      scene_card_id: sceneCardId.toString(),
      plan_message_id: planMessage.message_id.toString(),
      prompt_text: projection.prompt_text,
      parameters: frozenParameters,
      reference_assets: projection.reference_assets,
      reference_mode: referenceMode,
      capability_snapshot_version: snapshot,
    },
  });
  let cursor = createdJob.cursor;

  // 7. INSERT plan_application_receipts（不可变事实，带 scene_card_id + job_id + command_id）。
  const presetDigest = `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        canonicalizeJsonValue({
          parameters: frozenParameters,
          reference_mode: referenceMode,
          reference_assets: projection.reference_assets,
          capability_snapshot_version: snapshot,
        }),
      ),
    )
    .digest("hex")}`;
  const contentDigest = sha256Digest(planMessage.content_markdown);
  const appliedAt = new Date();
  const receipt = await tx.plan_application_receipts.create({
    data: {
      message_id: planMessage.message_id,
      project_id: projectId,
      application_kind: "scene_card_create",
      scene_card_id: sceneCardId,
      first_generation_job_id: BigInt(createdJob.generation_job_id),
      command_id: input.idempotencyKey,
      content_digest: contentDigest,
      result_version: 1,
      preset_digest: presetDigest,
      target_scene_card_mention_id: null,
      applied_at: appliedAt,
    },
  });

  // 8. INSERT scene_card_generation_presets（1:1，从冻结参数 + 投影创建）。
  await tx.scene_card_generation_presets.create({
    data: {
      scene_card_id: sceneCardId,
      project_id: projectId,
      parameters: frozenParameters as unknown as Prisma.InputJsonValue,
      reference_mode: referenceMode,
      reference_assets: projection.reference_assets as unknown as Prisma.InputJsonValue,
      capability_snapshot_version: snapshot as unknown as Prisma.InputJsonValue,
    },
  });

  // 9. INSERT scene_card_generation_records（首次 summary_status=generating）。
  await tx.scene_card_generation_records.create({
    data: {
      scene_card_id: sceneCardId,
      project_id: projectId,
      summary_status: "generating",
      plan_message_id: planMessage.message_id,
      application_receipt_id: receipt.id,
      first_generation_job_id: BigInt(createdJob.generation_job_id),
    },
  });

  // 10. INSERT command_idempotency（resource_id=scene_card_id，generation_job_id）。
  await tx.command_idempotency.create({
    data: {
      project_id: projectId,
      operation: OPERATION,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      generation_job_id: BigInt(createdJob.generation_job_id),
      resource_id: sceneCardId,
      accepted_cursor: BigInt(cursor),
    },
  });

  // 11. project_events：scene_card.created + plan_application.succeeded。
  const sceneCardEvent = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "scene_card.created",
    aggregateType: "scene_card",
    aggregateId: sceneCardId.toString(),
    aggregateVersion: 1,
    correlationId: input.idempotencyKey,
    payload: {
      scene_card_id: sceneCardId.toString(),
      plan_message_id: planMessage.message_id.toString(),
      generation_job_id: createdJob.generation_job_id,
    },
  });
  const applyEvent = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "plan_application.succeeded",
    aggregateType: "plan_application_receipt",
    aggregateId: receipt.id.toString(),
    aggregateVersion: 1,
    correlationId: input.idempotencyKey,
    payload: {
      receipt_id: receipt.id.toString(),
      message_id: planMessage.message_id.toString(),
      scene_card_id: sceneCardId.toString(),
      generation_job_id: createdJob.generation_job_id,
      application_kind: "scene_card_create",
    },
  });
  cursor = Math.max(cursor, Number(applyEvent.cursor), Number(sceneCardEvent.cursor));

  return {
    kind: "applied",
    scene_card_id: sceneCardId.toString(),
    generation_job_id: createdJob.generation_job_id,
    receipt_id: receipt.id.toString(),
    cursor: cursor.toString(),
  };
}

/** DB receipt 行 → 契约 PlanApplyImageReceipt（图片分支：scene_card_id 恒 null）。 */
function toImageReceiptView(row: {
  id: bigint;
  message_id: bigint;
  project_id: bigint;
  conversation_id: bigint | null;
  agent_run_id: bigint | null;
  first_generation_job_id: bigint;
  content_digest: string;
  applied_at: Date;
}): PlanApplyImageReceipt {
  return {
    receipt_id: row.id.toString(),
    plan_message_id: row.message_id.toString(),
    project_id: row.project_id.toString(),
    conversation_id: (row.conversation_id ?? 0n).toString(),
    agent_run_id: (row.agent_run_id ?? 0n).toString(),
    first_generation_job_id: row.first_generation_job_id.toString(),
    content_digest: row.content_digest,
    applied_at: row.applied_at.toISOString(),
    application_kind: "image_generate",
    scene_card_id: null,
  };
}

/** 单事务原子应用 image_generate PlanMessage（T10）。
 *  双层幂等（PlanMessage at-most-once + CommandId）+ 预检（mention/能力/余额，硬失败零写入）
 *  + 同 tx 建首图 job + receipt + plan_message.applied 事件。 */
async function applyImageGenerateInTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyPlanMessageInput,
  planMessage: {
    message_id: bigint;
    conversation_id: bigint;
    agent_run_id: bigint;
    application_kind: string;
    content_markdown: string;
    derived_references: unknown;
    frozen_generation_parameters: unknown;
    capability_snapshot_version: unknown;
    applied_at: Date | null;
    first_generation_job_id: bigint | null;
  },
): Promise<ApplyPlanMessageResult> {
  const pid = BigInt(input.projectId);
  const uid = BigInt(input.userId);
  const pmId = planMessage.message_id;

  // 1. PlanMessage 级 at-most-once：已应用 → 直接回首次回执（哪怕换 CommandId）。
  if (planMessage.applied_at !== null && planMessage.first_generation_job_id !== null) {
    const receipt = await tx.plan_application_receipts.findUnique({
      where: { message_id: pmId },
    });
    if (receipt) {
      return {
        kind: "already_applied_image",
        receipt: toImageReceiptView(receipt),
        first_generation_job_id: receipt.first_generation_job_id.toString(),
      };
    }
  }

  // 2. CommandId 级幂等：同键 replay / 异内容 conflict。
  const idem = await tx.command_idempotency.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: pid,
        operation: IMAGE_OPERATION,
        idempotency_key: input.idempotencyKey,
      },
    },
  });
  if (idem) {
    if (idem.request_hash !== input.requestHash) {
      return { kind: "idempotency_conflict" };
    }
    const receipt = await tx.plan_application_receipts.findUnique({
      where: { message_id: pmId },
    });
    if (receipt) {
      return {
        kind: "replayed_image",
        receipt: toImageReceiptView(receipt),
        first_generation_job_id: receipt.first_generation_job_id.toString(),
        cursor: idem.accepted_cursor.toString(),
      };
    }
    // 幂等行存在但 receipt 缺失（异常部分写）→ 保守不重做。
    return { kind: "plan_not_found" };
  }

  // 3. 预检（mention 重验 + 能力漂移 + 余额）—— 硬失败零写入、零幂等行。
  const derivedReferences = (planMessage.derived_references ?? []) as DerivedReference[];
  const assetRefs = derivedReferences.filter((r) => r.type === "asset");
  const mentionRows =
    assetRefs.length > 0
      ? await tx.conversation_message_mentions.findMany({
          where: { id: { in: assetRefs.map((r) => BigInt(r.mention_id)) } },
          select: {
            id: true,
            target_id: true,
            mention_type: true,
            target_version: true,
            accepted_user_id: true,
          },
        })
      : [];
  const { assetById } = await loadMentionTargetFacts(
    tx,
    mentionRows.map((m) => ({
      mention_type: m.mention_type,
      target_id: m.target_id,
    })),
  );
  let mentionUnavailable = false;
  for (const m of mentionRows) {
    const { availability } = classifyMentionAvailability({
      type: m.mention_type as "asset" | "scene_card",
      targetVersion: m.target_version,
      acceptedUserId: m.accepted_user_id,
      asset: assetById.get(m.target_id.toString()),
      projectId: pid,
      userId: uid,
    });
    if (availability === "unavailable") {
      mentionUnavailable = true;
      break;
    }
  }

  const snapshot = planMessage.capability_snapshot_version as CapabilitySnapshotVersion;
  const currentCap = await tx.generation_model_capability.findFirst({
    where: {
      model_id: snapshot.model_id,
      capability_type: snapshot.capability_type,
    },
    select: {
      version: true,
      enabled: true,
      is_delete: true,
      supported_sizes: true,
      supported_aspect_ratios: true,
      supported_durations: true,
      supported_formats: true,
      default_size: true,
      default_format: true,
      default_aspect_ratio: true,
      default_duration: true,
    },
  });
  let capabilityDrifted: boolean;
  if (!currentCap || currentCap.is_delete || !currentCap.enabled) {
    capabilityDrifted = true;
  } else {
    const currentDigest = capabilityDigest({
      supported_sizes: currentCap.supported_sizes,
      supported_aspect_ratios: currentCap.supported_aspect_ratios,
      supported_durations: currentCap.supported_durations,
      supported_formats: currentCap.supported_formats,
      default_size: currentCap.default_size,
      default_format: currentCap.default_format,
      default_aspect_ratio: currentCap.default_aspect_ratio,
      default_duration: currentCap.default_duration,
    });
    capabilityDrifted =
      currentCap.version !== snapshot.row_version || currentDigest !== snapshot.digest;
  }

  const quota = await input.quotaCheck!();
  const availability = classifyPlanApplicationAvailability({
    mentionUnavailable,
    capabilityDrifted,
    balanceSufficient: quota.sufficient,
  });
  if (availability === "requires_new_plan") {
    return mentionUnavailable
      ? {
          kind: "blocked_requires_new_plan",
          reason: "素材已失效",
          blockedBy: "mention_unavailable",
        }
      : {
          kind: "blocked_requires_new_plan",
          reason: "能力已变更",
          blockedBy: "capability_drifted",
        };
  }
  if (availability === "retryable_blocked") {
    return { kind: "blocked_retryable", reason: "余额不足" };
  }

  // 4. 建首图 GenerationJob（同 tx；source=plan_apply 保留入口可追溯）。
  const frozen = planMessage.frozen_generation_parameters as FrozenGenerationParameters;
  const referenceAssetIds = mentionRows
    .filter((m) => m.mention_type === "asset")
    .map((m) => m.target_id.toString());
  const jobInput: Record<string, unknown> = {
    prompt: planMessage.content_markdown,
    model_id: frozen.model_id,
    size: frozen.size,
    aspect_ratio: frozen.aspect_ratio,
    provider_credential: input.providerCredential,
    web_search: false,
    sequential_image_generation: false,
  };
  if (referenceAssetIds.length > 0) {
    jobInput.reference_asset_ids = referenceAssetIds;
  }
  const actionIdentity = createHash("sha256")
    .update(
      `${input.projectId}\0plan_apply\0${input.planMessageId}\0${input.idempotencyKey}`,
    )
    .digest("hex");
  const created = await createJobWithinTx(tx, {
    projectId: input.projectId,
    userId: input.userId,
    type: "image",
    expectedOutputCount: frozen.count,
    input: jobInput,
    actionIdentity,
    actionType: "generate_image",
    source: "plan_apply",
    agentRunId: planMessage.agent_run_id.toString(),
    planMessageId: input.planMessageId,
  });

  // 5. 建 receipt（uk_plan_application_receipt_message 兜底并发第二写）。
  const appliedAt = new Date();
  const contentDigest = `sha256:${createHash("sha256")
    .update(planMessage.content_markdown)
    .digest("hex")}`;
  const receipt = await tx.plan_application_receipts.create({
    data: {
      message_id: pmId,
      project_id: pid,
      conversation_id: planMessage.conversation_id,
      agent_run_id: planMessage.agent_run_id,
      application_kind: planMessage.application_kind,
      scene_card_id: null,
      first_generation_job_id: BigInt(created.generation_job_id),
      command_id: input.idempotencyKey,
      content_digest: contentDigest,
      result_version: null,
      preset_digest: null,
      target_scene_card_mention_id: null,
      applied_at: appliedAt,
    },
  });

  // 6. 标记 plan_message 已应用（at-most-once + 刷新恢复）。
  await tx.plan_messages.update({
    where: { message_id: pmId },
    data: {
      applied_at: appliedAt,
      first_generation_job_id: BigInt(created.generation_job_id),
    },
  });

  // 7. plan_message.applied 事件（前端据此刷新 applied 态；asset 放置由后续 asset.created 驱动）。
  const event = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "plan_message.applied",
    aggregateType: "plan_message",
    aggregateId: input.planMessageId,
    aggregateVersion: 0,
    correlationId: input.idempotencyKey,
    payload: {
      plan_message_id: input.planMessageId,
      application_kind: planMessage.application_kind,
      receipt_id: receipt.id.toString(),
      first_generation_job_id: created.generation_job_id,
    },
  });

  // 8. CommandId 幂等行（成功接纳才写）。
  await tx.command_idempotency.create({
    data: {
      project_id: pid,
      operation: IMAGE_OPERATION,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      message_id: pmId,
      generation_job_id: BigInt(created.generation_job_id),
      accepted_cursor: BigInt(event.cursor),
    },
  });

  return {
    kind: "applied_image",
    receipt: toImageReceiptView(receipt),
    first_generation_job_id: created.generation_job_id,
    cursor: event.cursor.toString(),
  };
}

/** 媒体感知分派：归属校验 + 读计划 → 按 application_kind 进对应事务。 */
async function applyPlanMessageInTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyPlanMessageInput,
): Promise<ApplyPlanMessageResult> {
  const projectId = BigInt(input.projectId);
  const userId = BigInt(input.userId);

  const project = await tx.project.findFirst({
    where: { id: projectId, owner_id: userId, is_delete: 0 },
    select: { id: true },
  });
  if (!project) return { kind: "forbidden" };

  const planMessage = await tx.plan_messages.findUnique({
    where: { message_id: BigInt(input.planMessageId) },
  });
  if (!planMessage || planMessage.project_id !== projectId)
    return { kind: "plan_not_found" };

  if (planMessage.application_kind === "scene_card_create") {
    return applySceneCardCreateInTransaction(tx, input);
  }
  if (planMessage.application_kind === "image_generate") {
    if (!input.providerCredential || !input.quotaCheck) {
      return { kind: "validation_failed", reason: "missing generation credential" };
    }
    return applyImageGenerateInTransaction(tx, input, planMessage);
  }
  return { kind: "kind_unsupported" };
}

export function createPlanApplicationRepo(
  prisma: PrismaClient,
): PlanApplicationRepo {
  return {
    applyPlanMessage(input) {
      return transactionWithUniqueRetry(prisma, (tx) =>
        applyPlanMessageInTransaction(tx, input),
      );
    },
  };
}
