// IK74V8：从 agent-run-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 临时交付追加、用户停止/重试命令、Provider 调用记录（契约 §8.1/§8.3/§8.4）。
import { Prisma, type PrismaClient } from "@prisma/client";

import { appendProjectEvent } from "./product-event-repo.js";
import { transactionWithUniqueRetry } from "./conversation-repo.js";
import {
  STOP_OPERATION,
  RETRY_OPERATION,
  databaseNow,
  isUniqueConstraintError,
  publicRunEventPayload,
  toProviderCallRecord,
} from "./agent-run-repo-internals.js";
import type { AgentRunRepo } from "./agent-run-repo-types.js";

export function createAppendProvisionalChunksOps(
  prisma: PrismaClient,
): Pick<AgentRunRepo, "appendProvisionalChunks" | "acceptUserStop" | "acceptUserRetry" | "loadProviderCall" | "openProviderCall" | "settleProviderCall" | "markProviderCallOutcomeUnknown"> {
  return {
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
