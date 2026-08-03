import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createAgentRunRepo } from "./agent-run-repo.js";

describe("AgentRunRepo", () => {
  it("claims one queued run with a higher fence and a stable input watermark", async () => {
    const now = new Date("2026-07-29T00:00:00.000Z");
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 9n,
          project_id: 42n,
          conversation_id: 7n,
          user_id: 100n,
          status: "queued",
          version: 0,
          fencing_token: 0n,
          input_sequence_no: 0,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 9n,
          project_id: 42n,
          conversation_id: 7n,
          user_id: 100n,
          version: 1,
          fencing_token: 1n,
          input_sequence_no: 0,
          lease_expires_at: new Date("2026-07-29T00:00:30.000Z"),
        }),
      },
      conversation_messages: {
        findMany: vi.fn().mockResolvedValue([
          { content: "第一条", sequence_no: 1 },
          { content: "第二条", sequence_no: 2 },
        ]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    const work = await createAgentRunRepo(prisma).claimNext({
      workerId: "worker-1",
      leaseMs: 30_000,
    });

    expect(tx.agent_runs.updateMany).toHaveBeenCalledWith({
      where: { id: 9n, status: "queued", version: 0 },
      data: expect.objectContaining({
        status: "running",
        lease_owner: "worker-1",
        fencing_token: { increment: 1n },
        version: { increment: 1 },
      }),
    });
    expect(work).toEqual(
      expect.objectContaining({
        agentRunId: "9",
        fence: "1",
        runVersion: 1,
        inputSequenceNo: 2,
        prompt: "第一条\n\n第二条",
      }),
    );
  });

  it("rejects a late commit whose lease owner, fence, or version no longer matches", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const now = new Date("2026-07-29T00:00:10.000Z");
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback({
          $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
          agent_runs: { updateMany },
        }),
      ),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitSuccess({
        workerId: "worker-1",
        agentRunId: "9",
        fence: "1",
        runVersion: 1,
        inputSequenceNo: 2,
        content: "完成",
      }),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("renews a live lease from database time without changing its fence or version", async () => {
    const now = new Date("2026-07-29T00:00:10.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
      agent_runs: { updateMany },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).renewLease({
        workerId: "worker-1",
        agentRunId: "9",
        fence: "1",
        runVersion: 1,
        leaseMs: 30_000,
      }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 9n,
        status: "running",
        lease_owner: "worker-1",
        lease_expires_at: { gt: now },
        fencing_token: 1n,
        version: 1,
        is_delete: 0,
      },
      data: {
        lease_expires_at: new Date("2026-07-29T00:00:40.000Z"),
      },
    });
  });

  it("releases the active-run guard when a run completes", async () => {
    const run = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      status: "running",
      stage: "responding",
      version: 2,
      fencing_token: 1n,
    };
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ db_now: new Date("2026-07-29T00:00:10.000Z") }]),
      agent_runs: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(run),
        update: vi.fn().mockResolvedValue({
          ...run,
          status: "completed",
          stage: "completed",
          version: 3,
        }),
      },
      conversation_messages: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 10n }),
      },
      conversations: {
        update: vi.fn().mockResolvedValue({ version: 3 }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi
          .fn()
          .mockResolvedValueOnce({ high_watermark: 1n })
          .mockResolvedValueOnce({ high_watermark: 2n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 11n,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitSuccess({
        workerId: "worker-1",
        agentRunId: "9",
        fence: "1",
        runVersion: 1,
        inputSequenceNo: 2,
        content: "完成",
      }),
    ).resolves.toEqual({
      kind: "committed",
      cursor: expect.any(String),
      status: "completed",
    });
    expect(tx.agent_runs.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({
        status: "completed",
        active_guard: null,
      }),
    });
  });

  it("commits a terminal failure that releases the guard without an assistant message", async () => {
    const run = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      status: "running",
      stage: "responding",
      version: 2,
      fencing_token: 1n,
      input_sequence_no: 2,
    };
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ db_now: new Date("2026-07-29T00:00:10.000Z") }]),
      agent_runs: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(run),
        update: vi.fn().mockResolvedValue({
          ...run,
          status: "failed",
          stage: null,
          version: 3,
        }),
      },
      conversation_messages: {
        create: vi.fn(),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 1n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 11n,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitFailure({
        workerId: "worker-1",
        agentRunId: "9",
        fence: "1",
        runVersion: 1,
        failureCode: "runtime_error",
        failureMessage: "fake agent explicit failure",
      }),
    ).resolves.toEqual({
      kind: "committed",
      cursor: expect.any(String),
      status: "failed",
    });
    expect(tx.agent_runs.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({
        status: "failed",
        stage: null,
        terminal_reason: "runtime_error",
        failure_code: "runtime_error",
        failure_message: "fake agent explicit failure",
        active_guard: null,
        lease_owner: null,
        lease_expires_at: null,
      }),
    });
    expect(tx.conversation_messages.create).not.toHaveBeenCalled();
  });

  it("rejects a late failure commit whose fence or version no longer matches", async () => {
    const now = new Date("2026-07-29T00:00:10.000Z");
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback({
          $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
          agent_runs: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
        }),
      ),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitFailure({
        workerId: "worker-1",
        agentRunId: "9",
        fence: "1",
        runVersion: 1,
        failureCode: "runtime_error",
        failureMessage: "boom",
      }),
    ).resolves.toEqual({ kind: "conflict" });
  });
});
