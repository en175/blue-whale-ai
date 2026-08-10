import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createAgentRunRepo } from "./agent-run-repo.js";

const now = new Date("2026-08-04T00:00:00.000Z");
const future = new Date("2026-08-04T00:01:00.000Z");

function runningRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 9n,
    project_id: 42n,
    conversation_id: 7n,
    user_id: 100n,
    status: "running",
    stage: null,
    version: 3,
    fencing_token: 5n,
    lease_owner: "worker-1",
    lease_expires_at: future,
    input_sequence_no: 1,
    terminal_reason: null,
    failure_code: null,
    retry_count: 0,
    is_delete: 0,
    activated_creative_skill_versions: [],
    reasoning_summary: null,
    ...overrides,
  };
}

function baseTx(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
    project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
    project_events: {
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          event_id: `evt_${Math.random().toString(16).slice(2)}`,
          event_type: data.event_type,
          cursor: 500n,
          project_id: data.project_id,
          aggregate_type: data.aggregate_type,
          aggregate_id: data.aggregate_id,
          aggregate_version: data.aggregate_version,
          correlation_id: null,
          causation_id: null,
          occurred_at: now,
          payload: data.payload,
        }),
      ),
    },
    project_event_stream: { upsert: vi.fn(), update: vi.fn() },
    ...overrides,
  };
}

describe("AgentRunRepo T07（IK67GZ）", () => {
  it("rejects late provisional chunks after a takeover bumps the fence（契约 §8.1）", async () => {
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback(
          baseTx({
            agent_runs: {
              // fence 已被接管递增到 6，旧 Worker 拿 fence 5 追加 chunk 必须冲突。
              findUnique: vi.fn().mockResolvedValue(runningRun({ fencing_token: 6n })),
            },
          }),
        ),
      ),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).appendProvisionalChunks({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "5",
        chunks: ["迟到文本"],
      }),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("rejects provisional chunks from a worker that no longer owns the lease", async () => {
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback(
          baseTx({
            agent_runs: {
              findUnique: vi
                .fn()
                .mockResolvedValue(runningRun({ lease_owner: "worker-2" })),
            },
          }),
        ),
      ),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).appendProvisionalChunks({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "5",
        chunks: ["迟到文本"],
      }),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("appends chunks to a streaming delivery and emits started + chunk events", async () => {
    const createDelivery = vi.fn().mockResolvedValue({
      id: 77n,
      agent_run_id: 9n,
      advance_id: 30n,
      fencing_token: 5n,
      status: "streaming",
      interruption_reason: null,
      content: "",
    });
    const createChunks = vi.fn().mockResolvedValue({ count: 2 });
    const eventTypes: string[] = [];
    const tx = baseTx({
      agent_runs: { findUnique: vi.fn().mockResolvedValue(runningRun()) },
      agent_advances: {
        findUnique: vi.fn().mockResolvedValue({
          id: 30n,
          agent_run_id: 9n,
          status: "running",
        }),
      },
      agent_provisional_deliveries: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: createDelivery,
        update: vi.fn().mockResolvedValue({}),
      },
      agent_provisional_chunks: {
        count: vi.fn().mockResolvedValue(0),
        createMany: createChunks,
      },
    });
    tx.project_events.create.mockImplementation(({ data }) => {
      eventTypes.push(data.event_type);
      return Promise.resolve({
        event_id: "evt_1",
        event_type: data.event_type,
        cursor: 500n,
        project_id: data.project_id,
        aggregate_type: data.aggregate_type,
        aggregate_id: data.aggregate_id,
        aggregate_version: data.aggregate_version,
        correlation_id: null,
        causation_id: null,
        occurred_at: now,
        payload: data.payload,
      });
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).appendProvisionalChunks({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "5",
        chunks: ["你好", "世界"],
      }),
    ).resolves.toEqual({ kind: "appended", deliveryId: "77", startIndex: 0 });
    expect(createDelivery).toHaveBeenCalledTimes(1);
    expect(createChunks).toHaveBeenCalledWith({
      data: [
        { delivery_id: 77n, chunk_index: 0, content: "你好" },
        { delivery_id: 77n, chunk_index: 1, content: "世界" },
      ],
    });
    expect(eventTypes).toEqual([
      "agent_run.provisional_delivery_started",
      "agent_run.provisional_chunk_appended",
      "agent_run.provisional_chunk_appended",
    ]);
  });

  it("acceptUserStop atomically cancels, bumps fence, interrupts delivery and in-flight call（契约 §8.2）", async () => {
    const stoppedRun = runningRun({
      status: "cancelled",
      stage: "cancelled",
      terminal_reason: "user_requested",
      version: 4,
      fencing_token: 6n,
      lease_owner: null,
      lease_expires_at: null,
    });
    const runUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const advanceUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deliveryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const callUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const receiptCreate = vi.fn().mockResolvedValue({});
    const tx = baseTx({
      agent_runs: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(runningRun())
          .mockResolvedValueOnce(stoppedRun),
        updateMany: runUpdateMany,
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: receiptCreate,
      },
      agent_advances: {
        findMany: vi.fn().mockResolvedValue([{ id: 30n }]),
        updateMany: advanceUpdateMany,
      },
      agent_provisional_deliveries: {
        findMany: vi.fn().mockResolvedValue([
          { id: 77n, advance_id: 30n, status: "streaming" },
        ]),
        updateMany: deliveryUpdateMany,
      },
      agent_provider_calls: { updateMany: callUpdateMany },
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).acceptUserStop({
        userId: "100",
        projectId: "42",
        agentRunId: "9",
        idempotencyKey: "key-1",
        requestHash: "hash-1",
      }),
    ).resolves.toEqual({ kind: "stopped", cursor: "500", status: "cancelled" });

    expect(runUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "cancelled",
          terminal_reason: "user_requested",
          fencing_token: { increment: 1n },
          version: { increment: 1 },
          lease_owner: null,
        }),
      }),
    );
    expect(advanceUpdateMany).toHaveBeenCalledWith({
      where: { agent_run_id: 9n, status: "running" },
      data: { status: "interrupted" },
    });
    expect(deliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "interrupted", interruption_reason: "user_cancelled" },
      }),
    );
    expect(callUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { advance_id: { in: [30n] }, status: "in_flight" },
        data: expect.objectContaining({ status: "outcome_unknown" }),
      }),
    );
    expect(receiptCreate).toHaveBeenCalledTimes(1);
  });

  it("acceptUserStop returns already_terminal for a completed run and replays the first receipt", async () => {
    const receiptFindUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        request_hash: "hash-1",
        accepted_cursor: 500n,
      });
    const tx = baseTx({
      agent_runs: {
        findUnique: vi
          .fn()
          .mockResolvedValue(runningRun({ status: "completed" })),
      },
      command_idempotency: { findUnique: receiptFindUnique },
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;
    const repo = createAgentRunRepo(prisma);
    const command = {
      userId: "100",
      projectId: "42",
      agentRunId: "9",
      idempotencyKey: "key-1",
      requestHash: "hash-1",
    };

    await expect(repo.acceptUserStop(command)).resolves.toEqual({
      kind: "already_terminal",
    });
    await expect(repo.acceptUserStop(command)).resolves.toEqual({
      kind: "replayed",
      cursor: "500",
      status: "cancelled",
    });
  });

  it("acceptUserRetry requeues a failed run with retry_count+1 and no message changes（契约 §8.3）", async () => {
    const runUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const receiptCreate = vi.fn().mockResolvedValue({});
    const tx = baseTx({
      agent_runs: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(runningRun({ status: "failed" }))
          .mockResolvedValueOnce(
            runningRun({ status: "queued", version: 4, retry_count: 1 }),
          ),
        updateMany: runUpdateMany,
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: receiptCreate,
      },
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).acceptUserRetry({
        userId: "100",
        projectId: "42",
        agentRunId: "9",
        idempotencyKey: "key-2",
        requestHash: "hash-2",
      }),
    ).resolves.toEqual({
      kind: "retried",
      cursor: "500",
      status: "queued",
      retryCount: 1,
    });
    expect(runUpdateMany).toHaveBeenCalledWith({
      where: { id: 9n, status: "failed", is_delete: 0 },
      data: {
        status: "queued",
        version: { increment: 1 },
        retry_count: { increment: 1 },
      },
    });
    expect(receiptCreate).toHaveBeenCalledTimes(1);
  });

  it("acceptUserRetry rejects non-failed runs", async () => {
    const tx = baseTx({
      agent_runs: {
        findUnique: vi
          .fn()
          .mockResolvedValue(runningRun({ status: "completed" })),
      },
      command_idempotency: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).acceptUserRetry({
        userId: "100",
        projectId: "42",
        agentRunId: "9",
        idempotencyKey: "key-2",
        requestHash: "hash-2",
      }),
    ).resolves.toEqual({ kind: "not_retryable" });
  });

  it("settleProviderCall rejects a late settlement whose fence no longer matches（契约 §8.4）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback(
          baseTx({ agent_provider_calls: { updateMany } }),
        ),
      ),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).settleProviderCall({
        advanceId: "30",
        callSlot: 0,
        fence: "5",
        status: "succeeded",
        resultPayload: { content: "结果" },
      }),
    ).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          advance_id: 30n,
          call_slot: 0,
          fencing_token: 5n,
          status: "in_flight",
        }),
      }),
    );
  });
});
