// IK74V8：从 agent-run-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 事务级共享工具：幂等常量、行投影、临时交付闭合、mention 冻结、回执重放、事件载荷。
import { Prisma } from "@prisma/client";
import {
  assetContextProjectionSchema,
  creativeSkillActivationSchema,
  sceneCardContextProjectionSchema,
  type AgentRunPin,
  type AutoCreativeSkillActivation,
  type CreativeSkillActivation,
  type MentionInputEntry,
  type MentionInputSnapshot,
} from "@blue-whale/contracts";

import { appendProjectEvent } from "./product-event-repo.js";
import {
  classifyMentionAvailability,
  type MentionClassificationInput,
} from "./mention-availability.js";
import type {
  CommitAgentRunResult,
  CommitAgentRunStatus,
  ProviderCallRecord,
} from "./agent-run-repo-types.js";

/** 用户停止/重试命令的幂等操作名（契约 §8.2/§8.3）。 */
export const STOP_OPERATION = "agent_run.stop";
export const RETRY_OPERATION = "agent_run.retry";

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export function toProviderCallRecord(row: {
  id: bigint;
  agent_run_id: bigint;
  advance_id: bigint;
  call_slot: number;
  fencing_token: bigint;
  status: string;
  request_digest: string;
  result_payload: unknown;
  failure_code: string | null;
  failure_message: string | null;
}): ProviderCallRecord {
  return {
    id: row.id.toString(),
    agentRunId: row.agent_run_id.toString(),
    advanceId: row.advance_id.toString(),
    callSlot: row.call_slot,
    fencingToken: row.fencing_token.toString(),
    status: row.status,
    requestDigest: row.request_digest,
    resultPayload: row.result_payload,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
  };
}

/** 临时交付闭合（契约 §8.1）：RunCommit/用户停止同事务内把当前 Advance 最新的
 *  streaming 交付置终态并发事件。completed 只由接纳正式消息的 commit 触发。 */
export async function closeStreamingDelivery(
  tx: Prisma.TransactionClient,
  run: { id: bigint; project_id: bigint },
  advanceId: bigint,
  aggregateVersion: number,
  outcome: "completed" | "interrupted",
  interruptionReason?: string,
): Promise<void> {
  const delivery = await tx.agent_provisional_deliveries.findFirst({
    where: { advance_id: advanceId, status: "streaming" },
    orderBy: { id: "desc" },
  });
  if (!delivery) return;
  await tx.agent_provisional_deliveries.update({
    where: { id: delivery.id },
    data:
      outcome === "completed"
        ? { status: "completed" }
        : {
            status: "interrupted",
            interruption_reason: interruptionReason ?? null,
          },
  });
  await appendProjectEvent(tx, {
    projectId: run.project_id.toString(),
    eventType:
      outcome === "completed"
        ? "agent_run.provisional_delivery_completed"
        : "agent_run.provisional_delivery_interrupted",
    aggregateType: "agent_run",
    aggregateId: run.id.toString(),
    aggregateVersion,
    correlationId: `run_${run.id.toString()}`,
    payload:
      outcome === "completed"
        ? {
            agent_run_id: run.id.toString(),
            advance_id: advanceId.toString(),
            delivery_id: delivery.id.toString(),
          }
        : {
            agent_run_id: run.id.toString(),
            advance_id: advanceId.toString(),
            delivery_id: delivery.id.toString(),
            reason: interruptionReason,
          },
  });
}

export async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ db_now: Date }>>(
    Prisma.sql`SELECT CURRENT_TIMESTAMP(3) AS db_now`,
  );
  const now = rows[0]?.db_now;
  if (!(now instanceof Date)) throw new Error("database time unavailable");
  return now;
}

export type MentionAssetFact = NonNullable<MentionClassificationInput["asset"]> & {
  id: bigint;
};
export type MentionSceneCardFact = NonNullable<
  MentionClassificationInput["sceneCard"]
> & { id: bigint };

/** 批量查询 mention 目标的当前事实（T08）：冻结路径与实时重查闸门共用。 */
export async function loadMentionTargetFacts(
  tx: Prisma.TransactionClient,
  mentions: Array<{ mention_type: string; target_id: bigint }>,
): Promise<{
  assetById: Map<string, MentionAssetFact>;
  sceneCardById: Map<string, MentionSceneCardFact>;
}> {
  const assetIds = [
    ...new Set(
      mentions
        .filter((mention) => mention.mention_type === "asset")
        .map((mention) => mention.target_id),
    ),
  ];
  const sceneCardIds = [
    ...new Set(
      mentions
        .filter((mention) => mention.mention_type === "scene_card")
        .map((mention) => mention.target_id),
    ),
  ];
  const [assets, sceneCards] = await Promise.all([
    assetIds.length === 0
      ? []
      : tx.assets.findMany({
          where: { id: { in: assetIds } },
          select: {
            id: true,
            user_id: true,
            project_id: true,
            status: true,
            is_delete: true,
          },
        }),
    sceneCardIds.length === 0
      ? []
      : tx.scene_cards.findMany({
          where: { id: { in: sceneCardIds } },
          select: { id: true, project_id: true, version: true, is_delete: true },
        }),
  ]);
  return {
    assetById: new Map(assets.map((asset) => [asset.id.toString(), asset])),
    sceneCardById: new Map(
      sceneCards.map((sceneCard) => [sceneCard.id.toString(), sceneCard]),
    ),
  };
}

/** 冻结本轮 MentionInputSnapshot（T08，IK67H3）：按本次 input_messages 的
 *  message_id JOIN conversation_message_mentions，对每条 mention 用**当前事实**
 *  重算 availability（对齐 snapshot-repo 的四态谓词），投影取自 mention 接纳时
 *  冻结的 snapshot（不含 storage_key/url/user_id）。unavailable 省略投影。
 *  与 mention 事实同事务边界冻结；接管复用既有 advance 的快照，不重算（AC#1/#2）。 */
export async function freezeMentionInputSnapshot(
  tx: Prisma.TransactionClient,
  run: { project_id: bigint; user_id: bigint },
  messageIds: bigint[],
): Promise<MentionInputSnapshot> {
  if (messageIds.length === 0) {
    return { capability_snapshot_version: 1, entries: [] };
  }
  const mentionRows = await tx.conversation_message_mentions.findMany({
    where: { message_id: { in: messageIds } },
    orderBy: [{ message_id: "asc" }, { mention_seq: "asc" }],
    select: {
      id: true,
      mention_seq: true,
      mention_type: true,
      target_id: true,
      target_version: true,
      accepted_user_id: true,
      snapshot: true,
    },
  });
  const relevant = mentionRows.filter(
    (mention) =>
      mention.mention_type === "asset" || mention.mention_type === "scene_card",
  );
  const pid = run.project_id;
  const uid = run.user_id;
  const { assetById, sceneCardById } = await loadMentionTargetFacts(tx, relevant);
  const entries: MentionInputEntry[] = [];
  for (const mention of relevant) {
    const type = mention.mention_type as "asset" | "scene_card";
    // 复用唯一可用性谓词（与 snapshot-repo 读路径同源，T08）。
    const { availability, reason } = classifyMentionAvailability({
      type,
      targetVersion: mention.target_version,
      acceptedUserId: mention.accepted_user_id,
      asset: assetById.get(mention.target_id.toString()),
      sceneCard: sceneCardById.get(mention.target_id.toString()),
      projectId: pid,
      userId: uid,
    });
    const entry: MentionInputEntry = {
      mention_id: mention.id.toString(),
      mention_seq: mention.mention_seq,
      type,
      availability,
      reason,
    };
    if (availability !== "unavailable") {
      const projected =
        type === "asset"
          ? assetContextProjectionSchema.safeParse(mention.snapshot)
          : sceneCardContextProjectionSchema.safeParse(mention.snapshot);
      if (projected.success) entry.projection = projected.data;
    }
    entries.push(entry);
  }
  return { capability_snapshot_version: 1, entries };
}

export function replayCommitReceipt(receipt: Prisma.JsonValue): CommitAgentRunResult {
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    Array.isArray(receipt) ||
    typeof receipt.cursor !== "string" ||
    !["queued", "awaiting_input", "completed", "failed", "cancelled"].includes(
      String(receipt.status),
    )
  ) {
    throw new Error("invalid stored RunCommit receipt");
  }
  return {
    kind: "replayed",
    cursor: receipt.cursor,
    status: receipt.status as CommitAgentRunStatus,
  };
}

export function resolvedCommitActivations(
  pin: AgentRunPin,
  autoActivation: AutoCreativeSkillActivation | null,
): CreativeSkillActivation[] | null {
  if (!autoActivation) return pin.activated_creative_skill_versions;
  if (pin.activated_creative_skill_versions.length > 0) return null;
  const candidate = pin.auto_creative_skill_candidates.find(
    (entry) =>
      entry.creative_skill_id === autoActivation.creative_skill_id &&
      entry.creative_skill_version_id ===
        autoActivation.creative_skill_version_id &&
      entry.resource_digest === autoActivation.resource_digest,
  );
  const resource = pin.creative_skill_resources.find(
    (entry) =>
      entry.creative_skill_id === autoActivation.creative_skill_id &&
      entry.creative_skill_version_id ===
        autoActivation.creative_skill_version_id &&
      entry.resource_digest === autoActivation.resource_digest,
  );
  if (
    !candidate ||
    !resource ||
    autoActivation.reason.type !== "agent_match" ||
    autoActivation.reason.detail.matched_fields.length !== 1 ||
    autoActivation.reason.detail.matched_fields[0] !== "conversation_messages"
  ) {
    return null;
  }
  return [
    {
      creative_skill_id: candidate.creative_skill_id,
      creative_skill_version_id: candidate.creative_skill_version_id,
      name: candidate.name,
      display_version: candidate.display_version,
      resource_digest: candidate.resource_digest,
      source: "auto",
      reason: {
        type: "agent_match",
        detail: { matched_fields: ["conversation_messages"] },
      },
    },
  ];
}

export function majorVersion(displayVersion: string): number {
  const value = Number.parseInt(displayVersion.split(".")[0] ?? "1", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export function publicActivations(value: unknown): CreativeSkillActivation[] {
  const parsed = creativeSkillActivationSchema.array().max(1).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function publicReasoningSummary(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 280
    ? value
    : null;
}

export function publicRunEventPayload(
  run: {
    id: bigint;
    conversation_id: bigint;
    activated_creative_skill_versions?: unknown;
    reasoning_summary?: unknown;
    terminal_reason?: unknown;
    failure_code?: unknown;
    retry_count?: unknown;
  },
  status: string,
  stage: string | null,
): Prisma.InputJsonObject {
  return {
    agent_run_id: run.id.toString(),
    conversation_id: run.conversation_id.toString(),
    status,
    stage,
    terminal_reason:
      run.terminal_reason === "user_requested" ||
      run.terminal_reason === "runtime_error"
        ? run.terminal_reason
        : null,
    failure_code:
      typeof run.failure_code === "string" && run.failure_code.length > 0
        ? run.failure_code
        : null,
    retry_count:
      typeof run.retry_count === "number" ? run.retry_count : 0,
    activated_creative_skill_versions: publicActivations(
      run.activated_creative_skill_versions,
    ),
    reasoning_summary: publicReasoningSummary(run.reasoning_summary),
  };
}

