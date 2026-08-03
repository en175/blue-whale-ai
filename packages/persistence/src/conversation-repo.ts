import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  AgentRuntimeManifest,
  CreativeSkillActivation,
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
  forcedCreativeSkillId: string | null;
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
    }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "input_request_conflict" }
  | { kind: "agent_run_conflict" }
  | { kind: "creative_skill_unavailable" }
  | { kind: "creative_skill_conflict" };

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
  };
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
    const message = await tx.conversation_messages.findUnique({
      where: { id: receipt.message_id },
      select: { sequence_no: true },
    });
    return replay(input.projectId, receipt, message?.sequence_no ?? 0);
  }

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
  let createdRunActivations: CreativeSkillActivation[] = [];
  if (run) {
    if (!conversation)
      throw new Error("active run is missing its conversation");
    if (input.forcedCreativeSkillId != null) {
      return { kind: "creative_skill_conflict" } as const;
    }
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
      data: { status: run.status },
    });
    run =
      requeued.count === 1
        ? await tx.agent_runs.findUnique({ where: { id: run.id } })
        : null;
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
        run_pin: pinResult.pin as Prisma.InputJsonValue,
        activated_creative_skill_versions: pinResult.pin
          .activated_creative_skill_versions as Prisma.InputJsonValue,
      },
    });
    const forcedActivation = pinResult.pin.activated_creative_skill_versions[0];
    if (forcedActivation?.source === "forced_use") {
      await tx.creative_skill_activation.create({
        data: {
          creative_skill_id: forcedActivation.creative_skill_id,
          user_id: userId,
          agent_run_id: run.id.toString(),
          skill_version: majorVersion(forcedActivation),
          activation_source: "forced",
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
