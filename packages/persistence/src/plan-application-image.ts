// IK74V8：从 plan-application-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 图片生成应用主路径：事务内配额预检、作业创建与回执落库。
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type {
  CapabilitySnapshotVersion,
  FrozenGenerationParameters,
} from "@blue-whale/contracts";

import { classifyPlanApplicationAvailability } from "@blue-whale/core";
import { appendProjectEvent } from "./product-event-repo.js";
import { createJobWithinTx } from "./generation-command-repo.js";
import { loadPlanApplicationFacts } from "./plan-application-facts.js";
import { loadMentionTargetFacts } from "./agent-run-repo.js";
import {
  IMAGE_OPERATION,
  toImageReceiptView,
} from "./plan-application-internals.js";
import type {
  ApplyPlanMessageInput,
  ApplyPlanMessageResult,
  DerivedReference,
} from "./plan-application-types.js";

export async function applyImageGenerateInTransaction(
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
  if (
    planMessage.applied_at !== null &&
    planMessage.first_generation_job_id !== null
  ) {
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
  const derivedReferences = (planMessage.derived_references ??
    []) as DerivedReference[];
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
  const snapshot =
    planMessage.capability_snapshot_version as CapabilitySnapshotVersion;
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
  // 事实采集（mention 重验 + 能力漂移）收敛到共用 helper：写路径 missingMention="ignore"
  // 保留原义——遍历查询结果，缺失 mention 行静默跳过，不阻断应用。
  const { mentionUnavailable, capabilityDrifted } = loadPlanApplicationFacts({
    derivedReferences,
    mentionFacts: new Map(
      mentionRows.map((m) => [
        m.id.toString(),
        {
          target_id: m.target_id,
          target_version: m.target_version,
          accepted_user_id: m.accepted_user_id,
        },
      ]),
    ),
    assetById,
    missingMention: "ignore",
    projectId: pid,
    userId: uid,
    capabilitySnapshot: snapshot,
    currentCapability: currentCap ?? undefined,
  });

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
  const frozen =
    planMessage.frozen_generation_parameters as FrozenGenerationParameters;
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
  // IKA72G：图片任务参考图统一 input_asset_ids 字段（与创建校验/worker 对齐）。
  if (referenceAssetIds.length > 0) {
    jobInput.input_asset_ids = referenceAssetIds;
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
    ...(input.costReservation ? { costReservation: input.costReservation } : {}),
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
