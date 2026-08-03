import { Prisma, type PrismaClient } from "@prisma/client";

import { appendProjectEvent } from "./product-event-repo.js";

export interface ClaimAgentRunInput {
  workerId: string;
  leaseMs: number;
}

export interface AgentRunWork {
  agentRunId: string;
  projectId: string;
  conversationId: string;
  userId: string;
  fence: string;
  runVersion: number;
  inputSequenceNo: number;
  prompt: string;
  /** 总结当前对话意图（IK60X1，契约 §15.2）：为真时 Worker 分流到总结管道。 */
  skillSummarize: boolean;
}

export interface CommitAgentRunSuccessInput {
  workerId: string;
  agentRunId: string;
  fence: string;
  runVersion: number;
  inputSequenceNo: number;
  content: string;
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
  fence: string;
  runVersion: number;
  failureCode: string;
  failureMessage: string;
}

export type CommitAgentRunResult =
  | {
      kind: "committed";
      cursor: string;
      status: "queued" | "completed" | "failed";
    }
  | { kind: "conflict" };

export interface AgentRunRepo {
  claimNext(input: ClaimAgentRunInput): Promise<AgentRunWork | null>;
  renewLease(input: RenewAgentRunLeaseInput): Promise<boolean>;
  commitSuccess(
    input: CommitAgentRunSuccessInput,
  ): Promise<CommitAgentRunResult>;
  commitFailure(
    input: CommitAgentRunFailureInput,
  ): Promise<CommitAgentRunResult>;
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ db_now: Date }>>(
    Prisma.sql`SELECT CURRENT_TIMESTAMP(3) AS db_now`,
  );
  const now = rows[0]?.db_now;
  if (!(now instanceof Date)) throw new Error("database time unavailable");
  return now;
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
            stage: "responding",
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
        const messages = await tx.conversation_messages.findMany({
          where: {
            agent_run_id: run.id,
            role: "user",
            sequence_no: { gt: run.input_sequence_no },
            is_delete: 0,
          },
          orderBy: { sequence_no: "asc" },
          select: { content: true, sequence_no: true },
        });
        const inputSequenceNo =
          messages.at(-1)?.sequence_no ?? run.input_sequence_no;
        return {
          agentRunId: run.id.toString(),
          projectId: run.project_id.toString(),
          conversationId: run.conversation_id.toString(),
          userId: run.user_id.toString(),
          fence: run.fencing_token.toString(),
          runVersion: run.version,
          inputSequenceNo,
          prompt: messages.map((message) => message.content).join("\n\n"),
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

    commitSuccess(input) {
      return prisma.$transaction(async (tx) => {
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

        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run) return { kind: "conflict" } as const;
        const newerInput = await tx.conversation_messages.findFirst({
          where: {
            agent_run_id: run.id,
            role: "user",
            sequence_no: { gt: input.inputSequenceNo },
            is_delete: 0,
          },
          orderBy: { sequence_no: "asc" },
          select: { id: true },
        });
        const nextStatus = newerInput ? "queued" : "completed";
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
            status: nextStatus,
            stage: nextStatus === "queued" ? "understanding" : "completed",
            active_guard: nextStatus === "queued" ? run.conversation_id : null,
            input_sequence_no: input.inputSequenceNo,
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
            status: nextStatus,
            stage: completedRun.stage,
          },
        });
        return {
          kind: "committed",
          cursor: runEvent.cursor,
          status: nextStatus,
        } as const;
      });
    },

    commitFailure(input) {
      return prisma.$transaction(async (tx) => {
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

        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run) return { kind: "conflict" } as const;
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
          payload: {
            agent_run_id: run.id.toString(),
            conversation_id: run.conversation_id.toString(),
            status: "failed",
            stage: null,
          },
        });
        return {
          kind: "committed",
          cursor: runEvent.cursor,
          status: "failed",
        } as const;
      });
    },
  };
}
