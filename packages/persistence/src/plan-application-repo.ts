import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canonicalizeJsonValue } from "@blue-whale/contracts";

import { createJobWithinTx } from "./generation-command-repo.js";
import { capabilityDigest } from "./capability-digest.js";
import { appendProjectEvent } from "./product-event-repo.js";
import { transactionWithUniqueRetry } from "./conversation-repo.js";

const OPERATION = "plan.message.apply";

/** 计划应用 repo 入参：User 手动应用一条 scene_card_create PlanMessage。
 *  idempotencyKey 即 CommandId；requestHash 由 handler 按 method/path/body 计算。 */
export interface ApplySceneCardCreatePlanInput {
  userId: string;
  projectId: string;
  planMessageId: string;
  idempotencyKey: string;
  requestHash: string;
}

export type ApplySceneCardCreateResult =
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
  | { kind: "forbidden" };

export interface PlanApplicationRepo {
  applySceneCardCreatePlan(
    input: ApplySceneCardCreatePlanInput,
  ): Promise<ApplySceneCardCreateResult>;
}

export interface CapabilitySnapshot {
  schema_version: number;
  capability_type: string;
  model_id: string;
  provider_id: string;
  row_version: number;
  digest: string;
}

export interface DerivedReference {
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
export async function validateDerivedReferences(
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
  input: ApplySceneCardCreatePlanInput,
): Promise<ApplySceneCardCreateResult> {
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

export function createPlanApplicationRepo(
  prisma: PrismaClient,
): PlanApplicationRepo {
  return {
    applySceneCardCreatePlan(input) {
      return transactionWithUniqueRetry(prisma, (tx) =>
        applySceneCardCreateInTransaction(tx, input),
      );
    },
  };
}
