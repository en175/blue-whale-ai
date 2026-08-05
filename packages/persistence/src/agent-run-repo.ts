import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  agentRunCommitSchema,
  agentRunPinSchema,
  agentRunWorkSchema,
  assetContextProjectionSchema,
  creativeSkillActivationSchema,
  deriveProviderPromptProjection,
  mentionInputSnapshotSchema,
  sceneCardContextProjectionSchema,
  type AgentRunPin,
  type AutoCreativeSkillActivation,
  type CapabilitySnapshotVersion,
  type CreativeSkillActivation,
  type DerivedReference,
  type FrozenGenerationParameters,
  type PlanApplicationKind,
  type PlanCardCandidate,
  type ProviderPromptProjection,
  type AgentRunWork as ContractAgentRunWork,
  type MentionInputEntry,
  type MentionInputSnapshot,
} from "@blue-whale/contracts";

import { appendProjectEvent } from "./product-event-repo.js";
import { capabilityDigest } from "./capability-digest.js";
import { transactionWithUniqueRetry } from "./conversation-repo.js";
import {
  classifyMentionAvailability,
  type MentionClassificationInput,
} from "./mention-availability.js";

/** 用户停止/重试命令的幂等操作名（契约 §8.2/§8.3）。 */
const STOP_OPERATION = "agent_run.stop";
const RETRY_OPERATION = "agent_run.retry";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function toProviderCallRecord(row: {
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
async function closeStreamingDelivery(
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

export interface ClaimAgentRunInput {
  workerId: string;
  leaseMs: number;
}

export type AgentRunWork = ContractAgentRunWork & {
  conversationId: string;
  userId: string;
  /** 总结当前对话意图（IK60X1，契约 §15.2）：为真时 Worker 分流到总结管道。 */
  skillSummarize: boolean;
};

export interface CommitAgentRunSuccessInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  content: string;
  reasoningSummary: string;
  autoCreativeSkillActivation: AutoCreativeSkillActivation | null;
}

/** RunCommit completed_with_plan 入参（T09，IK67H6，契约 §9）：
 *  携带完整有序候选 plan_cards；RunCommit 对整批原子验证后接纳为不可变 PlanMessage。
 *  plan_cards 形状已由 contracts planCardCandidateSchema 强制（worker 侧重放校验）。 */
export interface CommitAgentRunPlanInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  reasoningSummary: string;
  planCards: readonly PlanCardCandidate[];
  capabilitySnapshotVersion: 1;
}

export interface RenewAgentRunLeaseInput {
  workerId: string;
  agentRunId: string;
  fence: string;
  runVersion: number;
  leaseMs: number;
}

export interface CommitAgentRunFailureInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  failureCode: string;
  failureMessage: string;
}

export interface CommitAgentRunAwaitingInputInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  content: string;
  reasoningSummary: string;
  question: string;
  stage: "alignment" | "awaiting_final_confirmation";
}

export interface CommitAgentRunCancelledInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  content: string;
  reasoningSummary: string;
}

export interface AppendProvisionalChunksInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  chunks: string[];
}

export type AppendProvisionalChunksResult =
  | { kind: "appended"; deliveryId: string; startIndex: number }
  | { kind: "conflict" };

export interface AcceptAgentRunCommandInput {
  userId: string;
  projectId: string;
  agentRunId: string;
  idempotencyKey: string;
  requestHash: string;
}

export type AcceptAgentRunStopResult =
  | { kind: "stopped" | "replayed"; cursor: string; status: "cancelled" }
  | {
      kind:
        | "not_found"
        | "idempotency_conflict"
        | "already_terminal"
        | "not_stoppable";
    };

export type AcceptAgentRunRetryResult =
  | {
      kind: "retried" | "replayed";
      cursor: string;
      status: "queued";
      retryCount: number;
    }
  | { kind: "not_found" | "idempotency_conflict" | "not_retryable" };

export interface ProviderCallRecord {
  id: string;
  agentRunId: string;
  advanceId: string;
  callSlot: number;
  fencingToken: string;
  status: string;
  requestDigest: string;
  resultPayload: unknown;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface OpenProviderCallInput {
  agentRunId: string;
  advanceId: string;
  callSlot: number;
  fence: string;
  requestDigest: string;
}

export interface SettleProviderCallInput {
  advanceId: string;
  callSlot: number;
  fence: string;
  status: "succeeded" | "failed_definitive" | "outcome_unknown";
  resultPayload?: unknown;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export type CommitAgentRunStatus =
  | "queued"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export type CommitAgentRunResult =
  | {
      kind: "committed";
      cursor: string;
      status: CommitAgentRunStatus;
    }
  | {
      kind: "replayed";
      cursor: string;
      status: CommitAgentRunStatus;
    }
  | { kind: "conflict" };

export interface AgentRunRepo {
  claimNext(input: ClaimAgentRunInput): Promise<AgentRunWork | null>;
  renewLease(input: RenewAgentRunLeaseInput): Promise<boolean>;
  /** 硬权限闸门实时重查（T08，AC#5）：按快照条目用**当前事实**重跑可用性谓词。
   *  快照内容保持冻结不变（AC#1/#2），只裁决放行/拦截——冻结后的删除或撤权
   *  在此被检出，接管复用窗口不扩大授权。 */
  recheckMentionAuthority(input: {
    agentRunId: string;
    snapshot: MentionInputSnapshot;
  }): Promise<{ authoritative: boolean }>;
  commitSuccess(
    input: CommitAgentRunSuccessInput,
  ): Promise<CommitAgentRunResult>;
  /** 原子接纳计划卡候选为不可变 PlanMessage（T09，契约 §9，AC#1-8）。
   *  验证（结构 / 引用当前可用 / replace 独占 / 参数 ∈ 能力枚举）在 CAS 锁后、
   *  任何 conversation_messages / plan_messages 写入前；任一失败走 failed commit，零 plan 行。 */
  commitPlanMessages(
    input: CommitAgentRunPlanInput,
  ): Promise<CommitAgentRunResult>;
  commitFailure(
    input: CommitAgentRunFailureInput,
  ): Promise<CommitAgentRunResult>;
  commitAwaitingInput(
    input: CommitAgentRunAwaitingInputInput,
  ): Promise<CommitAgentRunResult>;
  commitCancelled(
    input: CommitAgentRunCancelledInput,
  ): Promise<CommitAgentRunResult>;
  appendProvisionalChunks(
    input: AppendProvisionalChunksInput,
  ): Promise<AppendProvisionalChunksResult>;
  acceptUserStop(
    input: AcceptAgentRunCommandInput,
  ): Promise<AcceptAgentRunStopResult>;
  acceptUserRetry(
    input: AcceptAgentRunCommandInput,
  ): Promise<AcceptAgentRunRetryResult>;
  loadProviderCall(
    advanceId: string,
    callSlot: number,
  ): Promise<ProviderCallRecord | null>;
  openProviderCall(input: OpenProviderCallInput): Promise<ProviderCallRecord>;
  settleProviderCall(input: SettleProviderCallInput): Promise<boolean>;
  markProviderCallOutcomeUnknown(
    advanceId: string,
    callSlot: number,
  ): Promise<boolean>;
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ db_now: Date }>>(
    Prisma.sql`SELECT CURRENT_TIMESTAMP(3) AS db_now`,
  );
  const now = rows[0]?.db_now;
  if (!(now instanceof Date)) throw new Error("database time unavailable");
  return now;
}

type MentionAssetFact = NonNullable<MentionClassificationInput["asset"]> & {
  id: bigint;
};
type MentionSceneCardFact = NonNullable<
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
async function freezeMentionInputSnapshot(
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

function replayCommitReceipt(receipt: Prisma.JsonValue): CommitAgentRunResult {
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

function resolvedCommitActivations(
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

function majorVersion(displayVersion: string): number {
  const value = Number.parseInt(displayVersion.split(".")[0] ?? "1", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function publicActivations(value: unknown): CreativeSkillActivation[] {
  const parsed = creativeSkillActivationSchema.array().max(1).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function publicReasoningSummary(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 280
    ? value
    : null;
}

function publicRunEventPayload(
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

function capabilityTypeForKind(kind: string): "image" | "video" {
  return kind === "image_generate" ? "image" : "video";
}

/** 从 content_markdown 解析 asset://<mention_id> 引用，按首次出现去重并记录偏移。 */
function parseAssetReferences(contentMarkdown: string): Array<{
  mentionId: string;
  firstSeenOffset: number;
}> {
  const pattern = /asset:\/\/([0-9]+)/g;
  const seen = new Map<string, number>();
  for (let match = pattern.exec(contentMarkdown); match !== null; match = pattern.exec(contentMarkdown)) {
    const mentionId = match[1];
    if (mentionId !== undefined && !seen.has(mentionId)) {
      seen.set(mentionId, match.index);
    }
  }
  return [...seen.entries()].map(([mentionId, firstSeenOffset]) => ({
    mentionId,
    firstSeenOffset,
  }));
}

function includesValue(list: unknown, value: unknown): boolean {
  return Array.isArray(list) && list.some((entry) => entry === value);
}

interface PreparedPlanMessage {
  readonly applicationKind: PlanApplicationKind;
  readonly contentMarkdown: string;
  readonly sequenceLabel: string | null;
  readonly targetSceneCardMentionId: string | null;
  readonly baseSceneCardVersion: number | null;
  readonly basePlanMessageId: string | null;
  readonly sourcePlanMessageId: string | null;
  readonly derivedReferences: DerivedReference[];
  readonly frozenParameters: FrozenGenerationParameters;
  readonly capabilitySnapshotVersion: CapabilitySnapshotVersion;
  readonly providerPromptProjection: ProviderPromptProjection;
}

interface MentionRecheckRow {
  readonly mention_id: string;
  readonly mention_seq: number;
  readonly type: "asset" | "scene_card";
  readonly target_id: bigint;
  readonly target_version: number | null;
  readonly currentAvailability: "available" | "stale" | "unavailable";
  readonly projection: unknown;
}

/** 计划卡验证 + 冻结准备（T09，AC#2/#5/#6/#7）。**零消息/计划写入**——只读与冻结计算。
 *  任一失败返回 failureMessage，调用方据此走 failed commit（零 plan 行）。
 *  - 结构：scene_card_replace 独占单卡；快照条目任一当前 unavailable → FAIL（AC#5 实时闸门）；
 *  - 引用：content_markdown 的 asset:// 必须命中本轮快照（幻觉 → FAIL），按首次出现去重；
 *    scene_card_replace 的 target 必须是本轮当前 available 的 scene_card mention，base 版本取其 target_version；
 *  - 能力：按 kind 选 image/video 能力行，overrides + defaults 冻结并校验 ∈ 枚举（AC#6）；
 *  - 投影：ProviderPromptProjection 由权威 Markdown 确定性派生（AC#7）。 */
async function validateAndPreparePlanCards(
  tx: Prisma.TransactionClient,
  run: { project_id: bigint; user_id: bigint },
  advance: { mention_input_snapshot: unknown },
  cards: readonly PlanCardCandidate[],
): Promise<
  | { ok: true; plans: PreparedPlanMessage[] }
  | { ok: false; failureMessage: string }
> {
  // 结构：scene_card_replace 必须独占单卡（CONTEXT：不能与其他类型混合，也不能多张 replace）。
  const replaceCards = cards.filter(
    (card) => card.application_kind === "scene_card_replace",
  );
  if (replaceCards.length > 1 || (replaceCards.length === 1 && cards.length > 1)) {
    return {
      ok: false,
      failureMessage:
        "scene_card_replace must be exclusive: exactly one card per submission",
    };
  }

  // 解析本轮 MentionInputSnapshot + 重查当前可用性（AC#5：读当前事实，不读冻结值）。
  const snapshotParse = mentionInputSnapshotSchema.safeParse(
    advance.mention_input_snapshot,
  );
  if (!snapshotParse.success) {
    return {
      ok: false,
      failureMessage: "mention input snapshot missing or invalid for advance",
    };
  }
  const snapshotEntries = snapshotParse.data.entries;
  const mentionRows = await tx.conversation_message_mentions.findMany({
    where: {
      id: { in: snapshotEntries.map((entry) => BigInt(entry.mention_id)) },
    },
    select: {
      id: true,
      mention_type: true,
      target_id: true,
      target_version: true,
      accepted_user_id: true,
    },
  });
  const mentionRowById = new Map(
    mentionRows.map((row) => [row.id.toString(), row]),
  );
  const { assetById, sceneCardById } = await loadMentionTargetFacts(
    tx,
    mentionRows,
  );
  const rechecked = new Map<string, MentionRecheckRow>();
  for (const entry of snapshotEntries) {
    const row = mentionRowById.get(entry.mention_id);
    if (
      !row ||
      (row.mention_type !== "asset" && row.mention_type !== "scene_card")
    ) {
      return {
        ok: false,
        failureMessage: `mention ${entry.mention_id} no longer resolvable`,
      };
    }
    const { availability } = classifyMentionAvailability({
      type: row.mention_type,
      targetVersion: row.target_version,
      acceptedUserId: row.accepted_user_id,
      asset: assetById.get(row.target_id.toString()),
      sceneCard: sceneCardById.get(row.target_id.toString()),
      projectId: run.project_id,
      userId: run.user_id,
    });
    // AC#5：任一快照条目当前 unavailable → 整批不得接纳。
    if (availability === "unavailable") {
      return {
        ok: false,
        failureMessage: `mention ${entry.mention_id} is currently unavailable`,
      };
    }
    rechecked.set(entry.mention_id, {
      mention_id: entry.mention_id,
      mention_seq: entry.mention_seq,
      type: row.mention_type,
      target_id: row.target_id,
      target_version: row.target_version,
      currentAvailability: availability,
      projection: entry.projection,
    });
  }

  // 血缘指针必须指向已接纳的 PlanMessage（幻觉 ID → 整批 FAIL，AC#2 原子性）。
  const lineageIds = [...new Set(
    cards.flatMap((card) => [
      card.base_plan_message_id,
      card.source_plan_message_id,
    ]),
  )].filter((id): id is string => Boolean(id));
  const existingPlanMessageIds = new Set(
    lineageIds.length === 0
      ? []
      : (
          await tx.plan_messages.findMany({
            where: { id: { in: lineageIds.map((id) => BigInt(id)) } },
            select: { id: true },
          })
        ).map((row) => row.id.toString()),
  );

  // 按应用类型预取能力行（image / video），同一批次同类型复用。
  const capabilityCache = new Map<"image" | "video", CapabilityRow>();
  const plans: PreparedPlanMessage[] = [];
  for (const card of cards) {
    for (const [label, lineageId] of [
      ["base_plan_message_id", card.base_plan_message_id],
      ["source_plan_message_id", card.source_plan_message_id],
    ] as const) {
      if (lineageId && !existingPlanMessageIds.has(lineageId)) {
        return {
          ok: false,
          failureMessage: `${label} ${lineageId} does not reference an existing plan message`,
        };
      }
    }
    const capabilityType = capabilityTypeForKind(card.application_kind);
    let capability = capabilityCache.get(capabilityType);
    if (!capability) {
      const found = await resolveCapability(tx, capabilityType);
      if (!found) {
        return {
          ok: false,
          failureMessage: `no enabled ${capabilityType} generation capability available`,
        };
      }
      capabilityCache.set(capabilityType, found);
      capability = found;
    }

    // content_markdown 的 asset:// 引用去重 → derived_references（幻觉 → FAIL）。
    const references = parseAssetReferences(card.content_markdown);
    const derivedReferences: DerivedReference[] = [];
    for (const reference of references) {
      const recheck = rechecked.get(reference.mentionId);
      if (!recheck) {
        return {
          ok: false,
          failureMessage: `card references unknown mention asset://${reference.mentionId}`,
        };
      }
      if (recheck.type !== "asset") {
        return {
          ok: false,
          failureMessage: `asset:// reference ${reference.mentionId} is not an asset mention`,
        };
      }
      const projectionParse = assetContextProjectionSchema.safeParse(
        recheck.projection,
      );
      if (!projectionParse.success) {
        return {
          ok: false,
          failureMessage: `mention ${reference.mentionId} projection missing for reference`,
        };
      }
      derivedReferences.push({
        mention_id: recheck.mention_id,
        mention_seq: recheck.mention_seq,
        type: "asset",
        first_seen_offset: reference.firstSeenOffset,
        projection: projectionParse.data,
      });
    }

    // scene_card_replace 的 target 必须是本轮当前 available 的 scene_card mention（非 stale）。
    let targetSceneCardMentionId: string | null = null;
    let baseSceneCardVersion: number | null = null;
    if (card.application_kind === "scene_card_replace") {
      const target = rechecked.get(card.target_scene_card_mention_id);
      if (!target || target.type !== "scene_card") {
        return {
          ok: false,
          failureMessage:
            "scene_card_replace target is not a scene_card mention in this round",
        };
      }
      if (target.currentAvailability !== "available") {
        return {
          ok: false,
          failureMessage:
            "scene_card_replace target scene card is stale or unavailable",
        };
      }
      targetSceneCardMentionId = target.mention_id;
      baseSceneCardVersion = target.target_version;
    }

    // 冻结生成参数（overrides + 能力 defaults，校验 ∈ 枚举，AC#6）。
    const overrides = card.parameter_overrides ?? {};
    const size = overrides.size ?? capability.default_size;
    if (!includesValue(capability.supported_sizes, size)) {
      return { ok: false, failureMessage: `unsupported size: ${size}` };
    }
    const aspectRatio =
      overrides.aspect_ratio ?? capability.default_aspect_ratio;
    if (!includesValue(capability.supported_aspect_ratios, aspectRatio)) {
      return {
        ok: false,
        failureMessage: `unsupported aspect_ratio: ${aspectRatio}`,
      };
    }
    const format =
      capabilityType === "image"
        ? (overrides.format ?? capability.default_format ?? null)
        : null;
    if (format !== null && !includesValue(capability.supported_formats, format)) {
      return { ok: false, failureMessage: `unsupported format: ${format}` };
    }
    const duration =
      capabilityType === "video"
        ? (overrides.duration ?? capability.default_duration ?? null)
        : null;
    if (
      duration !== null &&
      !includesValue(capability.supported_durations, duration)
    ) {
      return { ok: false, failureMessage: `unsupported duration: ${duration}` };
    }
    const count = overrides.count ?? 1;
    const frozenParameters: FrozenGenerationParameters = {
      capability_type: capabilityType,
      model_id: capability.model_id,
      provider_id: capability.provider_id,
      size,
      aspect_ratio: aspectRatio,
      format,
      duration,
      count,
    };

    const capabilitySnapshotVersion: CapabilitySnapshotVersion = {
      schema_version: 1,
      capability_type: capabilityType,
      model_id: capability.model_id,
      provider_id: capability.provider_id,
      row_version: capability.row_version,
      digest: capabilityDigest({
        supported_sizes: capability.supported_sizes,
        supported_aspect_ratios: capability.supported_aspect_ratios,
        supported_durations: capability.supported_durations,
        supported_formats: capability.supported_formats,
        default_size: capability.default_size,
        default_format: capability.default_format,
        default_aspect_ratio: capability.default_aspect_ratio,
        default_duration: capability.default_duration,
      }),
    };

    // AC#5：首/尾帧角色只能指向已验证的 derived_references（CONTEXT L179）。
    // 越界/不存在的 seq 不得静默降级为 reference，整批 FAIL。
    const firstFrameSeq = overrides.first_frame_mention_seq ?? null;
    const lastFrameSeq = overrides.last_frame_mention_seq ?? null;
    const validFrameSeqs = new Set(derivedReferences.map((ref) => ref.mention_seq));
    for (const [label, seq] of [
      ["first_frame_mention_seq", firstFrameSeq],
      ["last_frame_mention_seq", lastFrameSeq],
    ] as const) {
      if (seq !== null && !validFrameSeqs.has(seq)) {
        return {
          ok: false,
          failureMessage: `${label} ${seq} does not point to a verified derived reference`,
        };
      }
    }

    const providerPromptProjection = deriveProviderPromptProjection({
      content_markdown: card.content_markdown,
      derived_references: derivedReferences,
      frozen_generation_parameters: frozenParameters,
      first_frame_mention_seq: firstFrameSeq,
      last_frame_mention_seq: lastFrameSeq,
    });

    plans.push({
      applicationKind: card.application_kind,
      contentMarkdown: card.content_markdown,
      sequenceLabel: card.sequence_label_noun ?? null,
      targetSceneCardMentionId,
      baseSceneCardVersion,
      basePlanMessageId: card.base_plan_message_id ?? null,
      sourcePlanMessageId: card.source_plan_message_id ?? null,
      derivedReferences,
      frozenParameters,
      capabilitySnapshotVersion,
      providerPromptProjection,
    });
  }

  return { ok: true, plans };
}

interface CapabilityRow {
  readonly model_id: string;
  readonly provider_id: string;
  readonly row_version: number;
  readonly supported_sizes: unknown;
  readonly supported_aspect_ratios: unknown;
  readonly supported_durations: unknown;
  readonly supported_formats: unknown;
  readonly default_size: string;
  readonly default_format: string | null;
  readonly default_aspect_ratio: string;
  readonly default_duration: number | null;
}

/** 事务内按类型取首个启用能力（sort_order/id 升序），确定性选择。 */
async function resolveCapability(
  tx: Prisma.TransactionClient,
  capabilityType: "image" | "video",
): Promise<CapabilityRow | null> {
  const row = await tx.generation_model_capability.findFirst({
    where: { capability_type: capabilityType, enabled: true, is_delete: false },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
  });
  if (!row) return null;
  return {
    model_id: row.model_id,
    provider_id: row.provider_id,
    row_version: row.version,
    supported_sizes: row.supported_sizes,
    supported_aspect_ratios: row.supported_aspect_ratios,
    supported_durations: row.supported_durations,
    supported_formats: row.supported_formats,
    default_size: row.default_size,
    default_format: row.default_format,
    default_aspect_ratio: row.default_aspect_ratio,
    default_duration: row.default_duration,
  };
}

export function createAgentRunRepo(prisma: PrismaClient): AgentRunRepo {
  return {
    claimNext(input) {
      return prisma.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        const candidate = await tx.agent_runs.findFirst({
          where: {
            is_delete: 0,
            OR: [
              { status: "queued" },
              {
                status: "running",
                lease_expires_at: { lt: now },
              },
            ],
          },
          orderBy: { id: "asc" },
        });
        if (!candidate) return null;

        const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
        const claimed = await tx.agent_runs.updateMany({
          where:
            candidate.status === "queued"
              ? {
                  id: candidate.id,
                  status: "queued",
                  version: candidate.version,
                }
              : {
                  id: candidate.id,
                  status: "running",
                  version: candidate.version,
                  lease_expires_at: { lt: now },
                },
          data: {
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: leaseExpiresAt,
            fencing_token: { increment: 1n },
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) return null;

        const run = await tx.agent_runs.findUnique({
          where: { id: candidate.id },
        });
        if (!run) return null;
        const parsedRunPin = agentRunPinSchema.safeParse(run.run_pin);
        if (!parsedRunPin.success) {
          const failedRun = await tx.agent_runs.update({
            where: { id: run.id },
            data: {
              status: "failed",
              stage: null,
              terminal_reason: "runtime_error",
              failure_code: "runtime_pin_missing",
              failure_message:
                "AgentRun does not contain a valid immutable RunPin",
              active_guard: null,
              lease_owner: null,
              lease_expires_at: null,
            },
          });
          await appendProjectEvent(tx, {
            projectId: run.project_id.toString(),
            eventType: "agent_run.status_changed",
            aggregateType: "agent_run",
            aggregateId: run.id.toString(),
            aggregateVersion: failedRun.version,
            correlationId: `run_${run.id.toString()}`,
            payload: publicRunEventPayload(run, "failed", null),
          });
          return null;
        }
        const runPin = parsedRunPin.data;
        const runningAdvance = await tx.agent_advances.findFirst({
          where: { agent_run_id: run.id, status: "running" },
          orderBy: { ordinal: "desc" },
        });
        let advance = candidate.status === "running" ? runningAdvance : null;
        if (candidate.status === "running" && !advance) {
          throw new Error("active AgentRun is missing its running Advance");
        }
        if (!advance) {
          const latestAdvance = await tx.agent_advances.findFirst({
            where: { agent_run_id: run.id },
            orderBy: { ordinal: "desc" },
            select: { ordinal: true },
          });
          const messages = await tx.conversation_messages.findMany({
            where: {
              agent_run_id: run.id,
              role: "user",
              sequence_no: { gt: run.input_sequence_no },
              is_delete: 0,
            },
            orderBy: { sequence_no: "asc" },
            select: { id: true, role: true, content: true, sequence_no: true },
          });
          const inputSnapshot = messages.map((message) => ({
            message_id: message.id.toString(),
            sequence_no: message.sequence_no,
            role: message.role,
            content: message.content,
          }));
          const inputHighWatermark =
            messages.at(-1)?.sequence_no ?? run.input_sequence_no;
          // 同事务冻结本轮 MentionInputSnapshot（T08）：接管分支复用 runningAdvance
          // 的既有快照，不重算（AC#1/#2）。
          const mentionInputSnapshot = await freezeMentionInputSnapshot(
            tx,
            { project_id: run.project_id, user_id: run.user_id },
            messages.map((message) => message.id),
          );
          advance = await tx.agent_advances.create({
            data: {
              agent_run_id: run.id,
              ordinal: (latestAdvance?.ordinal ?? 0) + 1,
              status: "running",
              input_snapshot: inputSnapshot,
              input_high_watermark_sequence_no: inputHighWatermark,
              mention_input_snapshot: mentionInputSnapshot as Prisma.InputJsonValue,
            },
          });
        }
        await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: run.version,
          correlationId: `run_${run.id.toString()}`,
          payload: publicRunEventPayload(run, "running", run.stage),
        });
        const inputMessages = advance.input_snapshot;
        const snapshotRows = Array.isArray(inputMessages) ? inputMessages : [];
        const firstSnapshotRow = snapshotRows[0];
        const firstInputSequenceNo =
          typeof firstSnapshotRow === "object" &&
          firstSnapshotRow !== null &&
          "sequence_no" in firstSnapshotRow &&
          typeof firstSnapshotRow.sequence_no === "number"
            ? firstSnapshotRow.sequence_no
            : run.input_sequence_no + 1;
        const historyRows = await tx.conversation_messages.findMany({
          where: {
            conversation_id: run.conversation_id,
            role: { in: ["user", "assistant"] },
            sequence_no: { lt: firstInputSequenceNo },
            is_delete: 0,
          },
          orderBy: { sequence_no: "asc" },
          select: { role: true, content: true },
        });
        const historyMessages = historyRows.map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        }));
        const prompt = Array.isArray(inputMessages)
          ? inputMessages
              .map((message) =>
                typeof message === "object" &&
                message !== null &&
                "content" in message &&
                typeof message.content === "string"
                  ? message.content
                  : "",
              )
              .join("\n\n")
          : "";
        const contractWork = agentRunWorkSchema.parse({
          schema_version: 1,
          agent_run_id: run.id.toString(),
          advance_id: advance.id.toString(),
          fencing_token: run.fencing_token.toString(),
          run_version: run.version,
          input_high_watermark_sequence_no:
            advance.input_high_watermark_sequence_no,
          input_messages: inputMessages,
          history_messages: historyMessages,
          prompt,
          run_pin: runPin,
          auto_creative_skill_candidates: runPin.auto_creative_skill_candidates,
          activated_creative_skill_versions:
            runPin.activated_creative_skill_versions,
          mention_input_snapshot: advance.mention_input_snapshot ?? {
            capability_snapshot_version: 1,
            entries: [],
          },
        });
        return {
          ...contractWork,
          conversationId: run.conversation_id.toString(),
          userId: run.user_id.toString(),
          skillSummarize: run.skill_summarize,
        };
      });
    },

    renewLease(input) {
      return prisma.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        const renewed = await tx.agent_runs.updateMany({
          where: {
            id: BigInt(input.agentRunId),
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: { gt: now },
            fencing_token: BigInt(input.fence),
            version: input.runVersion,
            is_delete: 0,
          },
          data: {
            lease_expires_at: new Date(now.getTime() + input.leaseMs),
          },
        });
        return renewed.count === 1;
      });
    },

    recheckMentionAuthority(input) {
      if (input.snapshot.entries.length === 0) {
        return Promise.resolve({ authoritative: true });
      }
      return prisma.$transaction(async (tx) => {
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        // 保守裁决：Run 缺失/已删时无法证明授权，一律拦截。
        if (!run || run.is_delete !== 0) return { authoritative: false };
        const mentionRows = await tx.conversation_message_mentions.findMany({
          where: {
            id: {
              in: input.snapshot.entries.map((entry) => BigInt(entry.mention_id)),
            },
          },
          select: {
            id: true,
            mention_type: true,
            target_id: true,
            target_version: true,
            accepted_user_id: true,
          },
        });
        const mentionById = new Map(
          mentionRows.map((mention) => [mention.id.toString(), mention]),
        );
        const { assetById, sceneCardById } = await loadMentionTargetFacts(
          tx,
          mentionRows,
        );
        for (const entry of input.snapshot.entries) {
          const mention = mentionById.get(entry.mention_id);
          if (
            !mention ||
            (mention.mention_type !== "asset" &&
              mention.mention_type !== "scene_card")
          ) {
            return { authoritative: false };
          }
          const { availability } = classifyMentionAvailability({
            type: mention.mention_type,
            targetVersion: mention.target_version,
            acceptedUserId: mention.accepted_user_id,
            asset: assetById.get(mention.target_id.toString()),
            sceneCard: sceneCardById.get(mention.target_id.toString()),
            projectId: run.project_id,
            userId: run.user_id,
          });
          if (availability === "unavailable") return { authoritative: false };
        }
        return { authoritative: true };
      });
    },

    commitSuccess(input) {
      const commit = agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: input.advanceId,
        fencing_token: input.fence,
        expected_run_version: input.runVersion,
        request_digest: input.requestDigest,
        outcome: "completed",
        assistant_message: { content: input.content },
        reasoning_summary: input.reasoningSummary,
        auto_creative_skill_activation: input.autoCreativeSkillActivation,
      });
      if (commit.outcome !== "completed") {
        throw new Error("invalid completed RunCommit");
      }
      return prisma.$transaction(async (tx) => {
        const existing = await tx.run_commits.findUnique({
          where: { advance_id: BigInt(commit.advance_id) },
        });
        if (existing) {
          if (existing.request_digest !== commit.request_digest) {
            return { kind: "conflict" } as const;
          }
          return replayCommitReceipt(existing.receipt);
        }
        const advance = await tx.agent_advances.findUnique({
          where: { id: BigInt(commit.advance_id) },
        });
        if (!advance || advance.agent_run_id !== BigInt(input.agentRunId)) {
          return { kind: "conflict" } as const;
        }
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run) return { kind: "conflict" } as const;
        const runPin = agentRunPinSchema.parse(run.run_pin);
        const activations = resolvedCommitActivations(
          runPin,
          commit.auto_creative_skill_activation,
        );
        if (!activations) return { kind: "conflict" } as const;
        const now = await databaseNow(tx);
        const locked = await tx.agent_runs.updateMany({
          where: {
            id: BigInt(input.agentRunId),
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: { gt: now },
            fencing_token: BigInt(input.fence),
            version: input.runVersion,
            is_delete: 0,
          },
          data: { version: { increment: 1 } },
        });
        if (locked.count !== 1) return { kind: "conflict" } as const;
        const sequenced = await tx.conversations.update({
          where: { id: run.conversation_id },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        const message = await tx.conversation_messages.create({
          data: {
            conversation_id: run.conversation_id,
            project_id: run.project_id,
            agent_run_id: run.id,
            role: "assistant",
            content: input.content,
            sequence_no: sequenced.version,
          },
        });
        const completedRun = await tx.agent_runs.update({
          where: { id: run.id },
          data: {
            status: "completed",
            stage: "completed",
            active_guard: null,
            input_sequence_no: advance.input_high_watermark_sequence_no,
            activated_creative_skill_versions:
              activations as Prisma.InputJsonValue,
            reasoning_summary: commit.reasoning_summary,
            lease_owner: null,
            lease_expires_at: null,
          },
        });
        const messageEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "conversation.message_completed",
          aggregateType: "conversation",
          aggregateId: run.conversation_id.toString(),
          aggregateVersion: sequenced.version,
          correlationId: `run_${run.id.toString()}`,
          payload: {
            message_id: message.id.toString(),
            conversation_id: run.conversation_id.toString(),
            agent_run_id: run.id.toString(),
            role: "assistant",
            content: input.content,
            sequence_no: sequenced.version,
          },
        });
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: completedRun.version,
          correlationId: `run_${run.id.toString()}`,
          causationId: messageEvent.event_id,
          payload: {
            agent_run_id: run.id.toString(),
            conversation_id: run.conversation_id.toString(),
            status: "completed",
            stage: completedRun.stage,
            terminal_reason: null,
            failure_code: null,
            retry_count: completedRun.retry_count,
            activated_creative_skill_versions: activations,
            reasoning_summary: commit.reasoning_summary,
          },
        });
        // 临时交付提升边界（契约 §8.1）：只有 completed RunCommit 能把 streaming 交付置 completed。
        await closeStreamingDelivery(
          tx,
          run,
          advance.id,
          completedRun.version,
          "completed",
        );
        await tx.agent_advances.update({
          where: { id: advance.id },
          data: { status: "completed" },
        });
        // 只补「Worker 提议」路径的 auto 埋点：服务端在消息接纳缝已固定的 auto 激活
        // （资产契约 §16.2）已于接纳时落一行埋点，commit 不重复写。
        const autoActivation = commit.auto_creative_skill_activation
          ? activations.find((activation) => activation.source === "auto")
          : undefined;
        if (autoActivation) {
          await tx.creative_skill_activation.create({
            data: {
              creative_skill_id: autoActivation.creative_skill_id,
              user_id: run.user_id,
              agent_run_id: run.id.toString(),
              skill_version: majorVersion(autoActivation.display_version),
              activation_source: "auto",
            },
          });
        }
        const receipt = {
          cursor: runEvent.cursor,
          status: "completed",
        } as const;
        await tx.run_commits.create({
          data: {
            advance_id: advance.id,
            agent_run_id: run.id,
            request_digest: commit.request_digest,
            outcome: "completed",
            receipt: receipt as Prisma.InputJsonValue,
          },
        });
        return {
          kind: "committed",
          ...receipt,
        } as const;
      });
    },

    commitPlanMessages(input) {
      const commit = agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: input.advanceId,
        fencing_token: input.fence,
        expected_run_version: input.runVersion,
        request_digest: input.requestDigest,
        outcome: "completed_with_plan",
        reasoning_summary: input.reasoningSummary,
        plan_cards: input.planCards,
        capability_snapshot_version: input.capabilitySnapshotVersion,
      });
      if (commit.outcome !== "completed_with_plan") {
        throw new Error("invalid completed_with_plan RunCommit");
      }
      return prisma.$transaction(async (tx) => {
        const existing = await tx.run_commits.findUnique({
          where: { advance_id: BigInt(commit.advance_id) },
        });
        if (existing) {
          if (existing.request_digest !== commit.request_digest) {
            return { kind: "conflict" } as const;
          }
          return replayCommitReceipt(existing.receipt);
        }
        const advance = await tx.agent_advances.findUnique({
          where: { id: BigInt(commit.advance_id) },
        });
        if (!advance || advance.agent_run_id !== BigInt(input.agentRunId)) {
          return { kind: "conflict" } as const;
        }
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run) return { kind: "conflict" } as const;
        agentRunPinSchema.parse(run.run_pin);
        const now = await databaseNow(tx);
        const locked = await tx.agent_runs.updateMany({
          where: {
            id: BigInt(input.agentRunId),
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: { gt: now },
            fencing_token: BigInt(input.fence),
            version: input.runVersion,
            is_delete: 0,
          },
          data: { version: { increment: 1 } },
        });
        if (locked.count !== 1) return { kind: "conflict" } as const;

        // 验证阶段（零消息/计划写入前提）：任一失败 → failed commit，零 plan 行（AC#2）。
        const validation = await validateAndPreparePlanCards(
          tx,
          { project_id: run.project_id, user_id: run.user_id },
          advance,
          commit.plan_cards,
        );
        if (!validation.ok) {
          const failedRun = await tx.agent_runs.update({
            where: { id: run.id },
            data: {
              status: "failed",
              stage: null,
              terminal_reason: "runtime_error",
              failure_code: "plan_card_validation_failed",
              failure_message: validation.failureMessage,
              input_sequence_no: run.input_sequence_no,
              active_guard: null,
              lease_owner: null,
              lease_expires_at: null,
            },
          });
          const failedEvent = await appendProjectEvent(tx, {
            projectId: run.project_id.toString(),
            eventType: "agent_run.status_changed",
            aggregateType: "agent_run",
            aggregateId: run.id.toString(),
            aggregateVersion: failedRun.version,
            correlationId: `run_${run.id.toString()}`,
            payload: publicRunEventPayload(failedRun, "failed", null),
          });
          await closeStreamingDelivery(
            tx,
            run,
            advance.id,
            failedRun.version,
            "interrupted",
            "failed",
          );
          await tx.agent_advances.update({
            where: { id: advance.id },
            data: { status: "failed" },
          });
          const failedReceipt = {
            cursor: failedEvent.cursor,
            status: "failed",
          } as const;
          await tx.run_commits.create({
            data: {
              advance_id: advance.id,
              agent_run_id: run.id,
              request_digest: commit.request_digest,
              outcome: "failed",
              receipt: failedReceipt as Prisma.InputJsonValue,
            },
          });
          return { kind: "committed", ...failedReceipt } as const;
        }

        // 接纳阶段：每卡 conversations.version++ → conversation_messages(content_type=plan_message) → plan_messages。
        const activations = agentRunPinSchema.parse(
          run.run_pin,
        ).activated_creative_skill_versions;
        let lastCursor = "";
        for (
          let index = 0;
          index < validation.plans.length;
          index += 1
        ) {
          const plan = validation.plans[index];
          if (!plan) continue;
          const sequenced = await tx.conversations.update({
            where: { id: run.conversation_id },
            data: { version: { increment: 1 } },
            select: { version: true },
          });
          const message = await tx.conversation_messages.create({
            data: {
              conversation_id: run.conversation_id,
              project_id: run.project_id,
              agent_run_id: run.id,
              role: "assistant",
              content_type: "plan_message",
              content: plan.contentMarkdown,
              sequence_no: sequenced.version,
            },
          });
          await tx.plan_messages.create({
            data: {
              message_id: message.id,
              conversation_id: run.conversation_id,
              project_id: run.project_id,
              agent_run_id: run.id,
              ordinal: index + 1,
              total_in_batch: validation.plans.length,
              sequence_label: plan.sequenceLabel,
              application_kind: plan.applicationKind,
              target_scene_card_mention_id: plan.targetSceneCardMentionId
                ? BigInt(plan.targetSceneCardMentionId)
                : null,
              base_scene_card_version: plan.baseSceneCardVersion,
              content_markdown: plan.contentMarkdown,
              derived_references:
                plan.derivedReferences as Prisma.InputJsonValue,
              frozen_generation_parameters:
                plan.frozenParameters as Prisma.InputJsonValue,
              capability_snapshot_version:
                plan.capabilitySnapshotVersion as Prisma.InputJsonValue,
              provider_prompt_projection:
                plan.providerPromptProjection as Prisma.InputJsonValue,
              base_plan_message_id: plan.basePlanMessageId
                ? BigInt(plan.basePlanMessageId)
                : null,
              source_plan_message_id: plan.sourcePlanMessageId
                ? BigInt(plan.sourcePlanMessageId)
                : null,
            },
          });
          const messageEvent = await appendProjectEvent(tx, {
            projectId: run.project_id.toString(),
            eventType: "conversation.message_completed",
            aggregateType: "conversation",
            aggregateId: run.conversation_id.toString(),
            aggregateVersion: sequenced.version,
            correlationId: `run_${run.id.toString()}`,
            payload: {
              message_id: message.id.toString(),
              conversation_id: run.conversation_id.toString(),
              agent_run_id: run.id.toString(),
              role: "assistant",
              content_type: "plan_message",
              content: plan.contentMarkdown,
              sequence_no: sequenced.version,
            },
          });
          lastCursor = messageEvent.cursor;
        }
        const completedRun = await tx.agent_runs.update({
          where: { id: run.id },
          data: {
            status: "completed",
            stage: "completed",
            active_guard: null,
            input_sequence_no: advance.input_high_watermark_sequence_no,
            activated_creative_skill_versions:
              activations as Prisma.InputJsonValue,
            reasoning_summary: commit.reasoning_summary,
            lease_owner: null,
            lease_expires_at: null,
          },
        });
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: completedRun.version,
          correlationId: `run_${run.id.toString()}`,
          payload: {
            agent_run_id: run.id.toString(),
            conversation_id: run.conversation_id.toString(),
            status: "completed",
            stage: completedRun.stage,
            terminal_reason: null,
            failure_code: null,
            retry_count: completedRun.retry_count,
            activated_creative_skill_versions: activations,
            reasoning_summary: commit.reasoning_summary,
          },
        });
        lastCursor = runEvent.cursor;
        await closeStreamingDelivery(
          tx,
          run,
          advance.id,
          completedRun.version,
          "completed",
        );
        await tx.agent_advances.update({
          where: { id: advance.id },
          data: { status: "completed" },
        });
        const receipt = { cursor: lastCursor, status: "completed" } as const;
        await tx.run_commits.create({
          data: {
            advance_id: advance.id,
            agent_run_id: run.id,
            request_digest: commit.request_digest,
            outcome: "completed_with_plan",
            receipt: receipt as Prisma.InputJsonValue,
          },
        });
        return { kind: "committed", ...receipt } as const;
      });
    },

    commitFailure(input) {
      const commit = agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: input.advanceId,
        fencing_token: input.fence,
        expected_run_version: input.runVersion,
        request_digest: input.requestDigest,
        outcome: "failed",
        failure: {
          code: input.failureCode,
          message: input.failureMessage,
        },
      });
      if (commit.outcome !== "failed") {
        throw new Error("invalid failed RunCommit");
      }
      return prisma.$transaction(async (tx) => {
        const existing = await tx.run_commits.findUnique({
          where: { advance_id: BigInt(commit.advance_id) },
        });
        if (existing) {
          if (existing.request_digest !== commit.request_digest) {
            return { kind: "conflict" } as const;
          }
          return replayCommitReceipt(existing.receipt);
        }
        const advance = await tx.agent_advances.findUnique({
          where: { id: BigInt(commit.advance_id) },
        });
        if (!advance || advance.agent_run_id !== BigInt(input.agentRunId)) {
          return { kind: "conflict" } as const;
        }
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run) return { kind: "conflict" } as const;
        const now = await databaseNow(tx);
        const locked = await tx.agent_runs.updateMany({
          where: {
            id: BigInt(input.agentRunId),
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: { gt: now },
            fencing_token: BigInt(input.fence),
            version: input.runVersion,
            is_delete: 0,
          },
          data: { version: { increment: 1 } },
        });
        if (locked.count !== 1) return { kind: "conflict" } as const;
        const failedRun = await tx.agent_runs.update({
          where: { id: run.id },
          data: {
            status: "failed",
            stage: null,
            terminal_reason: "runtime_error",
            failure_code: input.failureCode,
            failure_message: input.failureMessage,
            // 保持原输入水位：失败不消费输入，接管或后续处理可重放同一批输入。
            input_sequence_no: run.input_sequence_no,
            active_guard: null,
            lease_owner: null,
            lease_expires_at: null,
          },
        });
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: failedRun.version,
          correlationId: `run_${run.id.toString()}`,
          payload: publicRunEventPayload(failedRun, "failed", null),
        });
        // 失败 RunCommit 同步中断 streaming 交付（契约 §8.1）：临时文本不进入永久会话。
        await closeStreamingDelivery(
          tx,
          run,
          advance.id,
          failedRun.version,
          "interrupted",
          "failed",
        );
        await tx.agent_advances.update({
          where: { id: advance.id },
          data: { status: "failed" },
        });
        const receipt = { cursor: runEvent.cursor, status: "failed" } as const;
        await tx.run_commits.create({
          data: {
            advance_id: advance.id,
            agent_run_id: run.id,
            request_digest: commit.request_digest,
            outcome: "failed",
            receipt: receipt as Prisma.InputJsonValue,
          },
        });
        return {
          kind: "committed",
          ...receipt,
        } as const;
      });
    },

    commitAwaitingInput(input) {
      const commit = agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: input.advanceId,
        fencing_token: input.fence,
        expected_run_version: input.runVersion,
        request_digest: input.requestDigest,
        outcome: "awaiting_input",
        assistant_message: { content: input.content },
        reasoning_summary: input.reasoningSummary,
        input_request: { question: input.question },
        stage: input.stage,
      });
      if (commit.outcome !== "awaiting_input") {
        throw new Error("invalid awaiting_input RunCommit");
      }
      return prisma.$transaction(async (tx) => {
        const existing = await tx.run_commits.findUnique({
          where: { advance_id: BigInt(commit.advance_id) },
        });
        if (existing) {
          if (existing.request_digest !== commit.request_digest) {
            return { kind: "conflict" } as const;
          }
          return replayCommitReceipt(existing.receipt);
        }
        const advance = await tx.agent_advances.findUnique({
          where: { id: BigInt(commit.advance_id) },
        });
        if (!advance || advance.agent_run_id !== BigInt(input.agentRunId)) {
          return { kind: "conflict" } as const;
        }
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run) return { kind: "conflict" } as const;
        const now = await databaseNow(tx);
        const activeRequest = await tx.user_input_requests.findFirst({
          where: {
            source_agent_run_id: run.id,
            status: "pending",
            expires_at: { gt: now },
            is_delete: 0,
          },
          select: { id: true },
        });
        if (activeRequest) return { kind: "conflict" } as const;
        const locked = await tx.agent_runs.updateMany({
          where: {
            id: BigInt(input.agentRunId),
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: { gt: now },
            fencing_token: BigInt(input.fence),
            version: input.runVersion,
            is_delete: 0,
          },
          data: { version: { increment: 1 } },
        });
        if (locked.count !== 1) return { kind: "conflict" } as const;
        const sequenced = await tx.conversations.update({
          where: { id: run.conversation_id },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        const message = await tx.conversation_messages.create({
          data: {
            conversation_id: run.conversation_id,
            project_id: run.project_id,
            agent_run_id: run.id,
            role: "assistant",
            content: input.content,
            sequence_no: sequenced.version,
          },
        });
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const inputRequest = await tx.user_input_requests.create({
          data: {
            project_id: run.project_id,
            user_id: run.user_id,
            request_type: "creation_clarification",
            conversation_id: run.conversation_id,
            source_agent_run_id: run.id,
            question: input.question,
            action_identity: `creation_clarification_${advance.id.toString()}`,
            action_type: "creation_clarification",
            arguments_digest: createHash("sha256")
              .update(input.question)
              .digest("hex"),
            status: "pending",
            expires_at: expiresAt,
          },
        });
        const awaitingRun = await tx.agent_runs.update({
          where: { id: run.id },
          data: {
            status: "awaiting_input",
            stage: commit.stage,
            input_sequence_no: advance.input_high_watermark_sequence_no,
            reasoning_summary: commit.reasoning_summary,
            lease_owner: null,
            lease_expires_at: null,
          },
        });
        const messageEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "conversation.message_completed",
          aggregateType: "conversation",
          aggregateId: run.conversation_id.toString(),
          aggregateVersion: sequenced.version,
          correlationId: `run_${run.id.toString()}`,
          payload: {
            message_id: message.id.toString(),
            conversation_id: run.conversation_id.toString(),
            agent_run_id: run.id.toString(),
            role: "assistant",
            content: input.content,
            sequence_no: sequenced.version,
          },
        });
        await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.user_input_requested",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: awaitingRun.version,
          correlationId: `run_${run.id.toString()}`,
          causationId: messageEvent.event_id,
          payload: {
            agent_run_id: run.id.toString(),
            input_request_id: inputRequest.id.toString(),
            request_type: "creation_clarification",
            question: input.question,
            status: "pending",
            expires_at: expiresAt.toISOString(),
          },
        });
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: awaitingRun.version,
          correlationId: `run_${run.id.toString()}`,
          payload: {
            agent_run_id: run.id.toString(),
            conversation_id: run.conversation_id.toString(),
            status: "awaiting_input",
            stage: awaitingRun.stage,
            activated_creative_skill_versions: publicActivations(
              run.activated_creative_skill_versions,
            ),
            reasoning_summary: commit.reasoning_summary,
          },
        });
        // 临时交付提升边界（契约 §8.1）：awaiting_input 也接纳正式消息，同步闭合 streaming 交付。
        await closeStreamingDelivery(
          tx,
          run,
          advance.id,
          awaitingRun.version,
          "completed",
        );
        await tx.agent_advances.update({
          where: { id: advance.id },
          data: { status: "completed" },
        });
        const receipt = {
          cursor: runEvent.cursor,
          status: "awaiting_input",
        } as const;
        await tx.run_commits.create({
          data: {
            advance_id: advance.id,
            agent_run_id: run.id,
            request_digest: commit.request_digest,
            outcome: "awaiting_input",
            receipt: receipt as Prisma.InputJsonValue,
          },
        });
        return {
          kind: "committed",
          ...receipt,
        } as const;
      });
    },

    commitCancelled(input) {
      const commit = agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: input.advanceId,
        fencing_token: input.fence,
        expected_run_version: input.runVersion,
        request_digest: input.requestDigest,
        outcome: "cancelled",
      });
      if (commit.outcome !== "cancelled") {
        throw new Error("invalid cancelled RunCommit");
      }
      return prisma.$transaction(async (tx) => {
        const existing = await tx.run_commits.findUnique({
          where: { advance_id: BigInt(commit.advance_id) },
        });
        if (existing) {
          if (existing.request_digest !== commit.request_digest) {
            return { kind: "conflict" } as const;
          }
          return replayCommitReceipt(existing.receipt);
        }
        const advance = await tx.agent_advances.findUnique({
          where: { id: BigInt(commit.advance_id) },
        });
        if (!advance || advance.agent_run_id !== BigInt(input.agentRunId)) {
          return { kind: "conflict" } as const;
        }
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run) return { kind: "conflict" } as const;
        const now = await databaseNow(tx);
        const locked = await tx.agent_runs.updateMany({
          where: {
            id: BigInt(input.agentRunId),
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: { gt: now },
            fencing_token: BigInt(input.fence),
            version: input.runVersion,
            is_delete: 0,
          },
          data: { version: { increment: 1 } },
        });
        if (locked.count !== 1) return { kind: "conflict" } as const;
        const sequenced = await tx.conversations.update({
          where: { id: run.conversation_id },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        const message = await tx.conversation_messages.create({
          data: {
            conversation_id: run.conversation_id,
            project_id: run.project_id,
            agent_run_id: run.id,
            role: "assistant",
            content: input.content,
            sequence_no: sequenced.version,
          },
        });
        const cancelledRun = await tx.agent_runs.update({
          where: { id: run.id },
          data: {
            status: "cancelled",
            stage: "cancelled",
            terminal_reason: "user_requested",
            input_sequence_no: advance.input_high_watermark_sequence_no,
            reasoning_summary: input.reasoningSummary,
            active_guard: null,
            lease_owner: null,
            lease_expires_at: null,
          },
        });
        const messageEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "conversation.message_completed",
          aggregateType: "conversation",
          aggregateId: run.conversation_id.toString(),
          aggregateVersion: sequenced.version,
          correlationId: `run_${run.id.toString()}`,
          payload: {
            message_id: message.id.toString(),
            conversation_id: run.conversation_id.toString(),
            agent_run_id: run.id.toString(),
            role: "assistant",
            content: input.content,
            sequence_no: sequenced.version,
          },
        });
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: cancelledRun.version,
          correlationId: `run_${run.id.toString()}`,
          causationId: messageEvent.event_id,
          payload: publicRunEventPayload(cancelledRun, "cancelled", "cancelled"),
        });
        // 临时交付提升边界（契约 §8.1）：cancelled RunCommit 也接纳正式消息，同步闭合 streaming 交付。
        await closeStreamingDelivery(
          tx,
          run,
          advance.id,
          cancelledRun.version,
          "completed",
        );
        await tx.agent_advances.update({
          where: { id: advance.id },
          data: { status: "completed" },
        });
        const receipt = {
          cursor: runEvent.cursor,
          status: "cancelled",
        } as const;
        await tx.run_commits.create({
          data: {
            advance_id: advance.id,
            agent_run_id: run.id,
            request_digest: commit.request_digest,
            outcome: "cancelled",
            receipt: receipt as Prisma.InputJsonValue,
          },
        });
        return {
          kind: "committed",
          ...receipt,
        } as const;
      });
    },

    appendProvisionalChunks(input) {
      if (input.chunks.length === 0) {
        return Promise.resolve({ kind: "conflict" } as const);
      }
      return prisma.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        // fence + lease 双校验（契约 §8.1）：接管/停止后旧 Worker 的迟到 chunk 一律冲突。
        if (
          !run ||
          run.is_delete !== 0 ||
          run.status !== "running" ||
          run.fencing_token !== BigInt(input.fence) ||
          run.lease_owner !== input.workerId ||
          !run.lease_expires_at ||
          run.lease_expires_at <= now
        ) {
          return { kind: "conflict" } as const;
        }
        const advance = await tx.agent_advances.findUnique({
          where: { id: BigInt(input.advanceId) },
        });
        if (
          !advance ||
          advance.agent_run_id !== run.id ||
          advance.status !== "running"
        ) {
          return { kind: "conflict" } as const;
        }
        let delivery = await tx.agent_provisional_deliveries.findFirst({
          where: {
            advance_id: advance.id,
            fencing_token: run.fencing_token,
            status: "streaming",
          },
        });
        let started = false;
        if (!delivery) {
          delivery = await tx.agent_provisional_deliveries.create({
            data: {
              agent_run_id: run.id,
              advance_id: advance.id,
              fencing_token: run.fencing_token,
              status: "streaming",
              content: "",
            },
          });
          started = true;
        }
        const startIndex = await tx.agent_provisional_chunks.count({
          where: { delivery_id: delivery.id },
        });
        await tx.agent_provisional_chunks.createMany({
          data: input.chunks.map((content, offset) => ({
            delivery_id: delivery!.id,
            chunk_index: startIndex + offset,
            content,
          })),
        });
        await tx.agent_provisional_deliveries.update({
          where: { id: delivery.id },
          data: { content: delivery.content + input.chunks.join("") },
        });
        if (started) {
          await appendProjectEvent(tx, {
            projectId: run.project_id.toString(),
            eventType: "agent_run.provisional_delivery_started",
            aggregateType: "agent_run",
            aggregateId: run.id.toString(),
            aggregateVersion: run.version,
            correlationId: `run_${run.id.toString()}`,
            payload: {
              agent_run_id: run.id.toString(),
              advance_id: advance.id.toString(),
              delivery_id: delivery.id.toString(),
            },
          });
        }
        for (const [offset, content] of input.chunks.entries()) {
          await appendProjectEvent(tx, {
            projectId: run.project_id.toString(),
            eventType: "agent_run.provisional_chunk_appended",
            aggregateType: "agent_run",
            aggregateId: run.id.toString(),
            aggregateVersion: run.version,
            correlationId: `run_${run.id.toString()}`,
            payload: {
              agent_run_id: run.id.toString(),
              delivery_id: delivery.id.toString(),
              chunk_index: startIndex + offset,
              content,
            },
          });
        }
        return {
          kind: "appended",
          deliveryId: delivery.id.toString(),
          startIndex,
        } as const;
      });
    },

    acceptUserStop(input) {
      return transactionWithUniqueRetry(prisma, async (tx) => {
        const projectId = BigInt(input.projectId);
        const project = await tx.project.findFirst({
          where: { id: projectId, owner_id: BigInt(input.userId), is_delete: 0 },
          select: { id: true },
        });
        if (!project) return { kind: "not_found" } as const;
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run || run.is_delete !== 0 || run.project_id !== projectId) {
          return { kind: "not_found" } as const;
        }
        const receipt = await tx.command_idempotency.findUnique({
          where: {
            project_id_operation_idempotency_key: {
              project_id: projectId,
              operation: STOP_OPERATION,
              idempotency_key: input.idempotencyKey,
            },
          },
        });
        if (receipt) {
          if (receipt.request_hash !== input.requestHash) {
            return { kind: "idempotency_conflict" } as const;
          }
          return {
            kind: "replayed",
            cursor: receipt.accepted_cursor.toString(),
            status: "cancelled",
          } as const;
        }
        if (
          ["completed", "failed", "cancelled", "recovery_failed"].includes(
            run.status,
          )
        ) {
          return { kind: "already_terminal" } as const;
        }
        if (run.status !== "queued" && run.status !== "running") {
          return { kind: "not_stoppable" } as const;
        }
        // 原子取消（契约 §8.2）：version 与 fence 同增，使旧 Worker 的续约/
        // chunk/RunCommit 全部 CAS 失败；停止不经 RunCommit、不产消息。
        const stopped = await tx.agent_runs.updateMany({
          where: {
            id: run.id,
            status: { in: ["queued", "running"] },
            is_delete: 0,
          },
          data: {
            status: "cancelled",
            stage: "cancelled",
            terminal_reason: "user_requested",
            version: { increment: 1 },
            fencing_token: { increment: 1n },
            lease_owner: null,
            lease_expires_at: null,
            active_guard: null,
          },
        });
        if (stopped.count !== 1) return { kind: "already_terminal" } as const;
        const cancelledRun = await tx.agent_runs.findUnique({
          where: { id: run.id },
        });
        if (!cancelledRun) return { kind: "already_terminal" } as const;
        const runningAdvances = await tx.agent_advances.findMany({
          where: { agent_run_id: run.id, status: "running" },
          select: { id: true },
        });
        const now = await databaseNow(tx);
        if (runningAdvances.length > 0) {
          // 只收敛当前 Advance 的 in_flight 调用（契约 §8.2）；历史 Advance 的
          // 调用在各自 commit 时已结算。
          await tx.agent_provider_calls.updateMany({
            where: {
              advance_id: { in: runningAdvances.map((entry) => entry.id) },
              status: "in_flight",
            },
            data: { status: "outcome_unknown", ended_at: now },
          });
        }
        await tx.agent_advances.updateMany({
          where: { agent_run_id: run.id, status: "running" },
          data: { status: "interrupted" },
        });
        const streamingDeliveries =
          await tx.agent_provisional_deliveries.findMany({
            where: { agent_run_id: run.id, status: "streaming" },
          });
        if (streamingDeliveries.length > 0) {
          await tx.agent_provisional_deliveries.updateMany({
            where: {
              id: { in: streamingDeliveries.map((entry) => entry.id) },
            },
            data: { status: "interrupted", interruption_reason: "user_cancelled" },
          });
          for (const delivery of streamingDeliveries) {
            await appendProjectEvent(tx, {
              projectId: run.project_id.toString(),
              eventType: "agent_run.provisional_delivery_interrupted",
              aggregateType: "agent_run",
              aggregateId: run.id.toString(),
              aggregateVersion: cancelledRun.version,
              correlationId: `run_${run.id.toString()}`,
              payload: {
                agent_run_id: run.id.toString(),
                advance_id: delivery.advance_id.toString(),
                delivery_id: delivery.id.toString(),
                reason: "user_cancelled",
              },
            });
          }
        }
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: cancelledRun.version,
          correlationId: `run_${run.id.toString()}`,
          payload: publicRunEventPayload(cancelledRun, "cancelled", "cancelled"),
        });
        await tx.command_idempotency.create({
          data: {
            project_id: projectId,
            operation: STOP_OPERATION,
            idempotency_key: input.idempotencyKey,
            request_hash: input.requestHash,
            agent_run_id: run.id,
            accepted_cursor: BigInt(runEvent.cursor),
          },
        });
        return {
          kind: "stopped",
          cursor: runEvent.cursor,
          status: "cancelled",
        } as const;
      });
    },

    acceptUserRetry(input) {
      return transactionWithUniqueRetry(prisma, async (tx) => {
        const projectId = BigInt(input.projectId);
        const project = await tx.project.findFirst({
          where: { id: projectId, owner_id: BigInt(input.userId), is_delete: 0 },
          select: { id: true },
        });
        if (!project) return { kind: "not_found" } as const;
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run || run.is_delete !== 0 || run.project_id !== projectId) {
          return { kind: "not_found" } as const;
        }
        const receipt = await tx.command_idempotency.findUnique({
          where: {
            project_id_operation_idempotency_key: {
              project_id: projectId,
              operation: RETRY_OPERATION,
              idempotency_key: input.idempotencyKey,
            },
          },
        });
        if (receipt) {
          if (receipt.request_hash !== input.requestHash) {
            return { kind: "idempotency_conflict" } as const;
          }
          const retriedRun = await tx.agent_runs.findUnique({
            where: { id: run.id },
            select: { retry_count: true },
          });
          return {
            kind: "replayed",
            cursor: receipt.accepted_cursor.toString(),
            status: "queued",
            retryCount: retriedRun?.retry_count ?? 0,
          } as const;
        }
        if (run.status !== "failed") {
          return { kind: "not_retryable" } as const;
        }
        // 手动重试（契约 §8.3）：failed→queued，不动消息与输入水位，
        // 下次 claim 创建新 Advance 消费同一批输入。
        const retried = await tx.agent_runs.updateMany({
          where: { id: run.id, status: "failed", is_delete: 0 },
          data: {
            status: "queued",
            version: { increment: 1 },
            retry_count: { increment: 1 },
          },
        });
        if (retried.count !== 1) return { kind: "not_retryable" } as const;
        const queuedRun = await tx.agent_runs.findUnique({
          where: { id: run.id },
        });
        if (!queuedRun) return { kind: "not_retryable" } as const;
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: queuedRun.version,
          correlationId: `run_${run.id.toString()}`,
          payload: publicRunEventPayload(queuedRun, "queued", queuedRun.stage),
        });
        await tx.command_idempotency.create({
          data: {
            project_id: projectId,
            operation: RETRY_OPERATION,
            idempotency_key: input.idempotencyKey,
            request_hash: input.requestHash,
            agent_run_id: run.id,
            accepted_cursor: BigInt(runEvent.cursor),
          },
        });
        return {
          kind: "retried",
          cursor: runEvent.cursor,
          status: "queued",
          retryCount: queuedRun.retry_count,
        } as const;
      });
    },

    async loadProviderCall(advanceId, callSlot) {
      const row = await prisma.agent_provider_calls.findUnique({
        where: {
          advance_id_call_slot: {
            advance_id: BigInt(advanceId),
            call_slot: callSlot,
          },
        },
      });
      return row ? toProviderCallRecord(row) : null;
    },

    async openProviderCall(input) {
      try {
        const row = await prisma.agent_provider_calls.create({
          data: {
            agent_run_id: BigInt(input.agentRunId),
            advance_id: BigInt(input.advanceId),
            call_slot: input.callSlot,
            fencing_token: BigInt(input.fence),
            status: "in_flight",
            request_digest: input.requestDigest,
          },
        });
        return toProviderCallRecord(row);
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const existing = await prisma.agent_provider_calls.findUnique({
          where: {
            advance_id_call_slot: {
              advance_id: BigInt(input.advanceId),
              call_slot: input.callSlot,
            },
          },
        });
        if (!existing) throw error;
        return toProviderCallRecord(existing);
      }
    },

    settleProviderCall(input) {
      return prisma.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        // 结算防护（契约 §8.4）：fencing_token 绑定开记录的持有者，status=in_flight
        // 是守卫——接管侧先行把记录置 outcome_unknown 后，任何迟到结算（含旧 Worker
        // 持原 fence 的真实结果）都无法再覆写；收敛次序由 claim 后的读取分支保证。
        const settled = await tx.agent_provider_calls.updateMany({
          where: {
            advance_id: BigInt(input.advanceId),
            call_slot: input.callSlot,
            fencing_token: BigInt(input.fence),
            status: "in_flight",
          },
          data: {
            status: input.status,
            result_payload:
              input.resultPayload === undefined
                ? Prisma.JsonNull
                : (input.resultPayload as Prisma.InputJsonValue),
            failure_code: input.failureCode ?? null,
            failure_message: input.failureMessage ?? null,
            ended_at: now,
          },
        });
        return settled.count === 1;
      });
    },

    markProviderCallOutcomeUnknown(advanceId, callSlot) {
      return prisma.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        // 接管侧收敛（契约 §8.4）：旧 in_flight 调用结果不明，置 unknown 后进入手动重试。
        const marked = await tx.agent_provider_calls.updateMany({
          where: {
            advance_id: BigInt(advanceId),
            call_slot: callSlot,
            status: "in_flight",
          },
          data: { status: "outcome_unknown", ended_at: now },
        });
        return marked.count === 1;
      });
    },
  };
}
