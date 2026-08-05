import { createHash } from "node:crypto";

import type { PrismaClient, Prisma } from "@prisma/client";

import {
  classifyPlanApplicationAvailability,
} from "@blue-whale/core";
import type {
  CapabilitySnapshotVersion,
  DerivedReference,
  FrozenGenerationParameters,
  PlanApplicationReceipt,
} from "@blue-whale/contracts";

import { appendProjectEvent } from "./product-event-repo.js";
import { transactionWithUniqueRetry } from "./conversation-repo.js";
import { classifyMentionAvailability } from "./mention-availability.js";
import {
  capabilityDigest,
  loadMentionTargetFacts,
} from "./agent-run-repo.js";
import { createGenerationCommandRepo } from "./generation-command-repo.js";

/** PlanMessage 手动应用操作名（command_idempotency.operation）。 */
const PLAN_APPLY_OPERATION = "plan_message.apply";

export interface ApplyPlanMessageInput {
  userId: string;
  projectId: string;
  planMessageId: string;
  idempotencyKey: string;
  /** method+path 摘要（对齐 agentRunCommandRequestHash）。 */
  requestHash: string;
  /** 密封后的 sk token（建首图 job 的 provider_credential）。 */
  providerCredential: string;
  /** 余额预检回调（事务内调用）；sufficient=false → retryable_blocked 零写入。 */
  quotaCheck: () => Promise<{ sufficient: boolean }>;
}

export type ApplyPlanMessageResult =
  | {
      kind: "applied";
      receipt: PlanApplicationReceipt;
      firstGenerationJobId: string;
      cursor: number;
    }
  | {
      kind: "replayed";
      receipt: PlanApplicationReceipt;
      firstGenerationJobId: string;
      cursor: number;
    }
  | {
      kind: "already_applied";
      receipt: PlanApplicationReceipt;
      firstGenerationJobId: string;
    }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "blocked_requires_new_plan"; reason: string }
  | { kind: "blocked_retryable"; reason: string };

export interface PlanApplicationRepo {
  /** 手动应用 image_generate 计划卡（T10）：双层幂等（PlanMessage at-most-once + CommandId）
   *  + 预检（mention/能力/余额，硬失败零写入）+ 同 tx 建首图 job + receipt + 事件。 */
  applyPlanMessage(input: ApplyPlanMessageInput): Promise<ApplyPlanMessageResult>;
}

/** DB receipt 行 → 契约 PlanApplicationReceipt（媒体感知：图片 scene_card_id 恒 null）。 */
function toReceiptView(row: {
  id: bigint;
  plan_message_id: bigint;
  project_id: bigint;
  conversation_id: bigint;
  agent_run_id: bigint;
  application_kind: string;
  first_generation_job_id: bigint;
  content_digest: string;
  applied_at: Date;
  scene_card_id: bigint | null;
  result_scene_card_version: number | null;
  generation_preset_digest: string | null;
}): PlanApplicationReceipt {
  const base = {
    receipt_id: row.id.toString(),
    plan_message_id: row.plan_message_id.toString(),
    project_id: row.project_id.toString(),
    conversation_id: row.conversation_id.toString(),
    agent_run_id: row.agent_run_id.toString(),
    first_generation_job_id: row.first_generation_job_id.toString(),
    content_digest: row.content_digest,
    applied_at: row.applied_at.toISOString(),
  };
  if (row.application_kind === "image_generate") {
    return { ...base, application_kind: "image_generate", scene_card_id: null };
  }
  return {
    ...base,
    application_kind: row.application_kind as
      | "scene_card_create"
      | "scene_card_replace",
    scene_card_id: row.scene_card_id?.toString() ?? null,
    result_scene_card_version: row.result_scene_card_version,
    generation_preset_digest: row.generation_preset_digest,
  };
}

export function createPlanApplicationRepo(
  prisma: PrismaClient,
): PlanApplicationRepo {
  // 复用 createJob（已扩展 source + caller tx），让首图 job 行在 apply 同事务内创建。
  const command = createGenerationCommandRepo(prisma);
  return {
    async applyPlanMessage(input) {
      const pid = BigInt(input.projectId);
      const uid = BigInt(input.userId);
      const pmId = BigInt(input.planMessageId);
      return transactionWithUniqueRetry(prisma, async (tx) => {
        // 1. 归属校验。
        const project = await tx.project.findFirst({
          where: { id: pid, owner_id: uid, is_delete: 0 },
          select: { id: true },
        });
        if (!project) return { kind: "not_found" } as const;

        // 2. 计划存在 + 归属本项目 + 本期仅 image_generate。
        const planMessage = await tx.plan_messages.findUnique({
          where: { message_id: pmId },
        });
        if (!planMessage || planMessage.project_id !== pid) {
          return { kind: "not_found" } as const;
        }
        if (planMessage.application_kind !== "image_generate") {
          return { kind: "not_found" } as const;
        }

        // 3. PlanMessage 级 at-most-once：已应用 → 直接回首次回执（哪怕换 CommandId）。
        if (
          planMessage.applied_at !== null &&
          planMessage.first_generation_job_id !== null
        ) {
          const receipt = await tx.plan_application_receipts.findUnique({
            where: { plan_message_id: pmId },
          });
          if (receipt) {
            return {
              kind: "already_applied",
              receipt: toReceiptView(receipt),
              firstGenerationJobId: receipt.first_generation_job_id.toString(),
            } as const;
          }
        }

        // 4. CommandId 级幂等：同键 replay / 异内容 conflict。
        const idem = await tx.command_idempotency.findUnique({
          where: {
            project_id_operation_idempotency_key: {
              project_id: pid,
              operation: PLAN_APPLY_OPERATION,
              idempotency_key: input.idempotencyKey,
            },
          },
        });
        if (idem) {
          if (idem.request_hash !== input.requestHash) {
            return { kind: "idempotency_conflict" } as const;
          }
          const receipt = await tx.plan_application_receipts.findUnique({
            where: { plan_message_id: pmId },
          });
          if (receipt) {
            return {
              kind: "replayed",
              receipt: toReceiptView(receipt),
              firstGenerationJobId: receipt.first_generation_job_id.toString(),
              cursor: Number(idem.accepted_cursor),
            } as const;
          }
          // 幂等行存在但 receipt 缺失（异常部分写）→ 保守不重做。
          return { kind: "not_found" } as const;
        }

        // 5. 预检（mention 重验 + 能力漂移 + 余额）—— 硬失败零写入、零幂等行。
        const derivedReferences = (
          planMessage.derived_references ?? []
        ) as DerivedReference[];
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
            currentCap.version !== snapshot.row_version ||
            currentDigest !== snapshot.digest;
        }

        const quota = await input.quotaCheck();
        const availability = classifyPlanApplicationAvailability({
          mentionUnavailable,
          capabilityDrifted,
          balanceSufficient: quota.sufficient,
        });
        if (availability === "requires_new_plan") {
          return {
            kind: "blocked_requires_new_plan",
            reason: mentionUnavailable ? "素材已失效" : "能力已变更",
          } as const;
        }
        if (availability === "retryable_blocked") {
          return {
            kind: "blocked_retryable",
            reason: "余额不足",
          } as const;
        }

        // 6. 建首图 GenerationJob（同 tx；source=plan_apply 保留入口可追溯）。
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
        if (referenceAssetIds.length > 0) {
          jobInput.reference_asset_ids = referenceAssetIds;
        }
        const actionIdentity = createHash("sha256")
          .update(
            `${input.projectId}\0plan_apply\0${input.planMessageId}\0${input.idempotencyKey}`,
          )
          .digest("hex");
        const created = await command.createJob(
          {
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
          },
          tx,
        );

        // 7. 建 receipt（uk plan_message_id 兜底并发第二写）。
        const appliedAt = new Date();
        const contentDigest = `sha256:${createHash("sha256")
          .update(planMessage.content_markdown)
          .digest("hex")}`;
        const receipt = await tx.plan_application_receipts.create({
          data: {
            plan_message_id: pmId,
            project_id: pid,
            conversation_id: planMessage.conversation_id,
            agent_run_id: planMessage.agent_run_id,
            application_kind: planMessage.application_kind,
            first_generation_job_id: BigInt(created.generation_job_id),
            content_digest: contentDigest,
            idempotency_key: input.idempotencyKey,
            scene_card_id: null,
            result_scene_card_version: null,
            generation_preset_digest: null,
            applied_at: appliedAt,
          },
        });

        // 8. 标记 plan_message 已应用（at-most-once + 刷新恢复）。
        await tx.plan_messages.update({
          where: { message_id: pmId },
          data: {
            applied_at: appliedAt,
            first_generation_job_id: BigInt(created.generation_job_id),
          },
        });

        // 9. plan_message.applied 事件（前端据此刷新 applied 态；asset 放置由后续 asset.created 驱动）。
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

        // 10. CommandId 幂等行（成功接纳才写）。
        await tx.command_idempotency.create({
          data: {
            project_id: pid,
            operation: PLAN_APPLY_OPERATION,
            idempotency_key: input.idempotencyKey,
            request_hash: input.requestHash,
            generation_job_id: BigInt(created.generation_job_id),
            accepted_cursor: BigInt(event.cursor),
          },
        });

        return {
          kind: "applied",
          receipt: toReceiptView(receipt),
          firstGenerationJobId: created.generation_job_id,
          cursor: Number(event.cursor),
        } as const;
      });
    },
  };
}
