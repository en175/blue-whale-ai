// IK74V8：从 agent-run-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// RunCommit 非成功终态：失败、等待输入、取消。
import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  agentRunCommitSchema,
} from "@blue-whale/contracts";

import { appendProjectEvent } from "./product-event-repo.js";
import {
  closeStreamingDelivery,
  databaseNow,
  publicActivations,
  publicRunEventPayload,
  replayCommitReceipt,
} from "./agent-run-repo-internals.js";
import type { AgentRunRepo } from "./agent-run-repo-types.js";

export function createCommitFailureOps(
  prisma: PrismaClient,
): Pick<AgentRunRepo, "commitFailure" | "commitAwaitingInput" | "commitCancelled"> {
  return {
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
  };
}
