import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  AcceptedConversationMention,
  ConversationMentionInput,
  MentionFailure,
} from "@blue-whale/core";
import {
  creativeSkillActivationSchema,
  type AgentRuntimeManifest,
  type CreativeSkillActivation,
} from "@blue-whale/contracts";

import { buildAgentRunPin } from "./agent-run-pin.js";
import { appendProjectEvent } from "./product-event-repo.js";

const OPERATION = "conversation.message.accept";
const ACTIVE_RUN_STATUSES = [
  "queued",
  "running",
  "awaiting_input",
  "awaiting_job",
] as const;

export interface AcceptConversationMessageRecord {
  userId: string;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
  clientMessageId: string;
  content: string;
  conversationId: string | null;
  replyToInputRequestId: string | null;
  mentions?: ConversationMentionInput[];
  /** 总结当前对话意图（IK60X1，契约 §15.2）：置位所属 agent_run.skill_summarize。 */
  skillSummarize?: boolean;
  forcedCreativeSkillId?: string | null;
}

export type AcceptedConversationRecord =
  | {
      kind: "accepted" | "replayed";
      project_id: string;
      conversation_id: string;
      message_id: string;
      agent_run_id: string;
      cursor: string;
      sequence_no: number;
      mentions: AcceptedConversationMention[];
    }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "input_request_conflict" }
  | { kind: "agent_run_conflict" }
  | { kind: "creative_skill_unavailable" }
  | { kind: "creative_skill_conflict" }
  | { kind: "mention_unavailable"; mentions: MentionFailure[] };

export interface ConversationRepo {
  acceptMessage(
    input: AcceptConversationMessageRecord,
  ): Promise<AcceptedConversationRecord>;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function transactionWithUniqueRetry<T>(
  prisma: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(operation);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return prisma.$transaction(operation);
  }
}

function replay(
  projectId: string,
  receipt: {
    request_hash: string;
    message_id: bigint | null;
    agent_run_id: bigint | null;
    resource_id: bigint | null;
    accepted_cursor: bigint;
  },
  sequenceNo: number,
  mentions: AcceptedConversationMention[],
): AcceptedConversationRecord {
  if (
    receipt.message_id === null ||
    receipt.agent_run_id === null ||
    receipt.resource_id === null
  ) {
    return { kind: "not_found" };
  }
  return {
    kind: "replayed",
    project_id: projectId,
    conversation_id: receipt.resource_id.toString(),
    message_id: receipt.message_id.toString(),
    agent_run_id: receipt.agent_run_id.toString(),
    cursor: receipt.accepted_cursor.toString(),
    sequence_no: sequenceNo,
    mentions,
  };
}

interface ResolvedMention {
  input: ConversationMentionInput;
  targetId: bigint;
  targetVersion: number | null;
  snapshot: Prisma.InputJsonObject;
}

interface LockedAssetMentionTarget {
  id: bigint;
  user_id: bigint;
  project_id: bigint;
  type: string;
  content_sha256: string | null;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  status: string;
  is_delete: boolean | number | bigint;
}

interface LockedSceneCardMentionTarget {
  id: bigint;
  project_id: bigint;
  title: string;
  summary: string | null;
  content_markdown: string;
  version: number;
  is_delete: number | bigint;
}

type ResolvedMentions =
  | { kind: "ready"; mentions: ResolvedMention[] }
  | { kind: "mention_unavailable"; mentions: MentionFailure[] };

function isDeletedFlag(value: boolean | number | bigint): boolean {
  return value === true || value === 1 || value === 1n;
}

async function resolveMentions(
  tx: Prisma.TransactionClient,
  input: AcceptConversationMessageRecord,
  projectId: bigint,
  userId: bigint,
): Promise<ResolvedMentions> {
  const mentions = input.mentions ?? [];
  if (mentions.length === 0) return { kind: "ready", mentions: [] };

  const assetIds = mentions.flatMap((mention) =>
    mention.type === "asset" ? [BigInt(mention.asset_id)] : [],
  );
  const sceneCardIds = mentions.flatMap((mention) =>
    mention.type === "scene_card" ? [BigInt(mention.scene_card_id)] : [],
  );
  const assets =
    assetIds.length === 0
      ? []
      : await tx.$queryRawUnsafe<LockedAssetMentionTarget[]>(
          `SELECT id, user_id, project_id, type, content_sha256, mime, size, width, height, duration_ms, status, is_delete
           FROM assets
           WHERE id IN (${assetIds.map(() => "?").join(",")})
           ORDER BY id FOR UPDATE`,
          ...assetIds,
        );
  const sceneCards =
    sceneCardIds.length === 0
      ? []
      : await tx.$queryRawUnsafe<LockedSceneCardMentionTarget[]>(
          `SELECT id, project_id, title, summary, content_markdown, version, is_delete
           FROM scene_cards
           WHERE id IN (${sceneCardIds.map(() => "?").join(",")})
           ORDER BY id FOR UPDATE`,
          ...sceneCardIds,
        );
  const assetById = new Map(
    assets.map((asset) => [asset.id.toString(), asset]),
  );
  const sceneCardById = new Map(
    sceneCards.map((sceneCard) => [sceneCard.id.toString(), sceneCard]),
  );
  const failures: MentionFailure[] = [];
  const resolved: ResolvedMention[] = [];

  mentions.forEach((mention, index) => {
    if (mention.type === "asset") {
      const asset = assetById.get(mention.asset_id);
      if (
        !asset ||
        isDeletedFlag(asset.is_delete) ||
        asset.status !== "normal"
      ) {
        failures.push({ index, type: mention.type, reason: "deleted" });
        return;
      }
      if (asset.project_id !== projectId) {
        failures.push({ index, type: mention.type, reason: "wrong_project" });
        return;
      }
      if (asset.user_id !== userId) {
        failures.push({
          index,
          type: mention.type,
          reason: "permission_lost",
        });
        return;
      }
      resolved.push({
        input: mention,
        targetId: asset.id,
        targetVersion: null,
        snapshot: {
          asset_type: asset.type,
          mime: asset.mime,
          size: asset.size?.toString() ?? null,
          width: asset.width,
          height: asset.height,
          duration_ms: asset.duration_ms,
          content_sha256: asset.content_sha256,
        },
      });
      return;
    }

    const sceneCard = sceneCardById.get(mention.scene_card_id);
    if (!sceneCard || isDeletedFlag(sceneCard.is_delete)) {
      failures.push({ index, type: mention.type, reason: "deleted" });
      return;
    }
    if (sceneCard.project_id !== projectId) {
      failures.push({ index, type: mention.type, reason: "wrong_project" });
      return;
    }
    if (sceneCard.version !== mention.scene_card_version) {
      failures.push({ index, type: mention.type, reason: "stale" });
      return;
    }
    resolved.push({
      input: mention,
      targetId: sceneCard.id,
      targetVersion: mention.scene_card_version,
      snapshot: {
        title: sceneCard.title,
        summary: sceneCard.summary,
        content_markdown: sceneCard.content_markdown,
        version: sceneCard.version,
      },
    });
  });

  return failures.length > 0
    ? { kind: "mention_unavailable", mentions: failures }
    : { kind: "ready", mentions: resolved };
}

function publicRunActivations(value: unknown): CreativeSkillActivation[] {
  const parsed = creativeSkillActivationSchema.array().max(1).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function publicRunReasoningSummary(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 280
    ? value
    : null;
}

export async function acceptConversationMessageInTransaction(
  tx: Prisma.TransactionClient,
  input: AcceptConversationMessageRecord,
  manifest: AgentRuntimeManifest,
): Promise<AcceptedConversationRecord> {
  const projectId = BigInt(input.projectId);
  const userId = BigInt(input.userId);
  const project = await tx.project.findFirst({
    where: {
      id: projectId,
      owner_id: userId,
      is_delete: 0,
    },
    select: { id: true },
  });
  if (!project) return { kind: "not_found" } as const;

  const receipt = await tx.command_idempotency.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: projectId,
        operation: OPERATION,
        idempotency_key: input.idempotencyKey,
      },
    },
  });
  if (receipt) {
    if (receipt.request_hash !== input.requestHash) {
      return { kind: "idempotency_conflict" } as const;
    }
    if (receipt.message_id === null) return { kind: "not_found" } as const;
    const [message, mentionRows] = await Promise.all([
      tx.conversation_messages.findUnique({
        where: { id: receipt.message_id },
        select: { sequence_no: true },
      }),
      tx.conversation_message_mentions.findMany({
        where: { message_id: receipt.message_id },
        orderBy: { mention_seq: "asc" },
        select: { id: true, mention_seq: true, mention_type: true },
      }),
    ]);
    return replay(
      input.projectId,
      receipt,
      message?.sequence_no ?? 0,
      mentionRows.map((mention) => ({
        mention_id: mention.id.toString(),
        index: mention.mention_seq,
        type: mention.mention_type as "asset" | "scene_card",
      })),
    );
  }

  const resolvedMentions = await resolveMentions(tx, input, projectId, userId);
  if (resolvedMentions.kind !== "ready") return resolvedMentions;

  let conversation: { id: bigint; project_id: bigint } | null = null;
  if (input.conversationId !== null) {
    conversation = await tx.conversations.findFirst({
      where: {
        id: BigInt(input.conversationId),
        project_id: projectId,
        is_delete: 0,
      },
      select: { id: true, project_id: true },
    });
    if (!conversation) return { kind: "not_found" } as const;
  } else {
    conversation = await tx.conversations.findFirst({
      where: { project_id: projectId, is_delete: 0 },
      orderBy: { id: "desc" },
      select: { id: true, project_id: true },
    });
  }

  let run = conversation
    ? await tx.agent_runs.findFirst({
        where: {
          conversation_id: conversation.id,
          status: { in: [...ACTIVE_RUN_STATUSES] },
          is_delete: 0,
        },
        orderBy: { id: "desc" },
      })
    : null;
  let inputRequest: {
    id: bigint;
    source_agent_run_id: bigint | null;
  } | null = null;
  if (input.replyToInputRequestId !== null) {
    if (!conversation) return { kind: "input_request_conflict" } as const;
    inputRequest = await tx.user_input_requests.findFirst({
      where: {
        id: BigInt(input.replyToInputRequestId),
        project_id: projectId,
        user_id: userId,
        conversation_id: conversation.id,
        status: "pending",
        expires_at: { gt: new Date() },
        is_delete: 0,
      },
      select: { id: true, source_agent_run_id: true },
    });
    if (
      !inputRequest ||
      inputRequest.source_agent_run_id === null ||
      run?.id !== inputRequest.source_agent_run_id
    ) {
      return { kind: "input_request_conflict" } as const;
    }
  } else if (run?.status === "awaiting_input") {
    return { kind: "input_request_conflict" } as const;
  }

  let createdRun = false;
  let resumedRun = false;
  let createdRunActivations: CreativeSkillActivation[] = [];
  if (run) {
    if (!conversation)
      throw new Error("active run is missing its conversation");
    if (input.forcedCreativeSkillId != null) {
      return { kind: "creative_skill_conflict" } as const;
    }
    if (run.status === "awaiting_input") {
      const resumed = await tx.agent_runs.updateMany({
        where: {
          id: run.id,
          version: run.version,
          status: "awaiting_input",
          active_guard: conversation.id,
          is_delete: 0,
        },
        data: {
          status: "queued",
          version: { increment: 1 },
          ...(input.skillSummarize ? { skill_summarize: true } : {}),
        },
      });
      if (resumed.count !== 1) {
        return { kind: "input_request_conflict" } as const;
      }
      run = await tx.agent_runs.findUnique({ where: { id: run.id } });
      resumedRun = true;
    } else {
      if (run.status !== "queued") {
        return { kind: "agent_run_conflict" } as const;
      }
      const requeued = await tx.agent_runs.updateMany({
        where: {
          id: run.id,
          version: run.version,
          status: { in: [...ACTIVE_RUN_STATUSES] },
          active_guard: conversation.id,
          is_delete: 0,
        },
        data: {
          status: run.status,
          ...(input.skillSummarize ? { skill_summarize: true } : {}),
        },
      });
      run =
        requeued.count === 1
          ? await tx.agent_runs.findUnique({ where: { id: run.id } })
          : null;
    }
  }
  if (!run) {
    const pinResult = await buildAgentRunPin(
      tx,
      userId,
      input.forcedCreativeSkillId ?? null,
      manifest,
    );
    if (pinResult.kind !== "ready") return pinResult;
    createdRunActivations = pinResult.pin.activated_creative_skill_versions;
    if (!conversation) {
      conversation = await tx.conversations.create({
        data: { project_id: projectId },
        select: { id: true, project_id: true },
      });
    }
    run = await tx.agent_runs.create({
      data: {
        project_id: projectId,
        conversation_id: conversation.id,
        active_guard: conversation.id,
        user_id: userId,
        status: "queued",
        stage: "understanding",
        engine: "typescript-agent",
        engine_version: "1",
        adapter_schema_version: 1,
        // 新建 Run 直接按本条消息意图置位（契约 §15.2）。
        skill_summarize: input.skillSummarize === true,
        run_pin: pinResult.pin as Prisma.InputJsonValue,
        activated_creative_skill_versions: pinResult.pin
          .activated_creative_skill_versions as Prisma.InputJsonValue,
      },
    });
    // 成功激活埋点（契约 §11.3/§16.2）：forced 与 auto 均落一行，只增不改。
    const activation = pinResult.pin.activated_creative_skill_versions[0];
    if (activation) {
      await tx.creative_skill_activation.create({
        data: {
          creative_skill_id: activation.creative_skill_id,
          user_id: userId,
          agent_run_id: run.id.toString(),
          skill_version: majorVersion(activation),
          activation_source:
            activation.source === "forced_use" ? "forced" : "auto",
        },
      });
    }
    createdRun = true;
  }
  if (!conversation) throw new Error("agent run is missing its conversation");

  const sequenced = await tx.conversations.update({
    where: { id: conversation.id },
    data: { version: { increment: 1 } },
    select: { id: true, version: true },
  });
  const sequenceNo = sequenced.version;
  const message = await tx.conversation_messages.create({
    data: {
      conversation_id: conversation.id,
      project_id: projectId,
      agent_run_id: run.id,
      client_message_id: input.clientMessageId,
      role: "user",
      content: input.content,
      sequence_no: sequenceNo,
    },
  });
  const acceptedMentions: AcceptedConversationMention[] = [];
  for (const [index, mention] of resolvedMentions.mentions.entries()) {
    const fact = await tx.conversation_message_mentions.create({
      data: {
        message_id: message.id,
        conversation_id: conversation.id,
        project_id: projectId,
        accepted_user_id: userId,
        mention_seq: index,
        mention_type: mention.input.type,
        target_id: mention.targetId,
        target_version: mention.targetVersion,
        display_name: mention.input.display_name,
        snapshot: mention.snapshot,
      },
      select: { id: true },
    });
    acceptedMentions.push({
      mention_id: fact.id.toString(),
      index,
      type: mention.input.type,
    });
  }

  if (inputRequest) {
    await tx.user_input_requests.update({
      where: { id: inputRequest.id },
      data: {
        status: "answered",
        confirmed_at: new Date(),
        answer_message_id: message.id,
        resumed_agent_run_id: run.id,
        version: { increment: 1 },
      },
    });
  }

  const messageEvent = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "conversation.message_accepted",
    aggregateType: "conversation",
    aggregateId: conversation.id.toString(),
    aggregateVersion: sequenceNo,
    correlationId: input.clientMessageId,
    payload: {
      message_id: message.id.toString(),
      conversation_id: conversation.id.toString(),
      agent_run_id: run.id.toString(),
      role: "user",
      content: input.content,
      sequence_no: sequenceNo,
      mentions: resolvedMentions.mentions.map((mention, index) => ({
        ...acceptedMentions[index],
        display_name: mention.input.display_name,
        availability: "available",
        reason: null,
      })),
    },
  });
  let cursor = messageEvent.cursor;
  if (inputRequest) {
    const inputAnsweredEvent = await appendProjectEvent(tx, {
      projectId: input.projectId,
      eventType: "agent_run.user_input_answered",
      aggregateType: "agent_run",
      aggregateId: run.id.toString(),
      aggregateVersion: run.version,
      correlationId: input.clientMessageId,
      causationId: messageEvent.event_id,
      payload: {
        agent_run_id: run.id.toString(),
        input_request_id: inputRequest.id.toString(),
        answer_message_id: message.id.toString(),
        status: "answered",
      },
    });
    cursor = inputAnsweredEvent.cursor;
  }
  if (resumedRun) {
    const resumedEvent = await appendProjectEvent(tx, {
      projectId: input.projectId,
      eventType: "agent_run.status_changed",
      aggregateType: "agent_run",
      aggregateId: run.id.toString(),
      aggregateVersion: run.version,
      correlationId: input.clientMessageId,
      payload: {
        agent_run_id: run.id.toString(),
        conversation_id: conversation.id.toString(),
        status: run.status,
        stage: run.stage,
        terminal_reason:
          run.terminal_reason === "user_requested" ||
          run.terminal_reason === "runtime_error"
            ? run.terminal_reason
            : null,
        failure_code: run.failure_code,
        retry_count: run.retry_count,
        activated_creative_skill_versions: publicRunActivations(
          run.activated_creative_skill_versions,
        ),
        reasoning_summary: publicRunReasoningSummary(run.reasoning_summary),
      },
    });
    cursor = resumedEvent.cursor;
  }
  if (createdRun) {
    const runEvent = await appendProjectEvent(tx, {
      projectId: input.projectId,
      eventType: "agent_run.created",
      aggregateType: "agent_run",
      aggregateId: run.id.toString(),
      aggregateVersion: run.version,
      correlationId: input.clientMessageId,
      payload: {
        agent_run_id: run.id.toString(),
        conversation_id: conversation.id.toString(),
        status: run.status,
        stage: run.stage,
        terminal_reason: null,
        failure_code: null,
        retry_count: 0,
        activated_creative_skill_versions: createdRunActivations,
        reasoning_summary: null,
      },
    });
    cursor = runEvent.cursor;
  }

  await tx.command_idempotency.create({
    data: {
      project_id: projectId,
      operation: OPERATION,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      message_id: message.id,
      agent_run_id: run.id,
      resource_id: conversation.id,
      accepted_cursor: BigInt(cursor),
    },
  });

  return {
    kind: "accepted",
    project_id: input.projectId,
    conversation_id: conversation.id.toString(),
    message_id: message.id.toString(),
    agent_run_id: run.id.toString(),
    cursor,
    sequence_no: sequenceNo,
    mentions: acceptedMentions,
  } as const;
}

function majorVersion(activation: CreativeSkillActivation): number {
  const value = Number.parseInt(
    activation.display_version.split(".")[0] ?? "1",
    10,
  );
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export function createConversationRepo(
  prisma: PrismaClient,
  manifest: AgentRuntimeManifest,
): ConversationRepo {
  return {
    acceptMessage(input) {
      return transactionWithUniqueRetry(prisma, (tx) =>
        acceptConversationMessageInTransaction(tx, input, manifest),
      );
    },
  };
}
