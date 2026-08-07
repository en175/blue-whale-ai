// IK74V8：从 agent-run-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import type {PrismaClient} from "@prisma/client";
import {describe, expect, it, vi} from "vitest";

import {createAgentRunRepo} from "./agent-run-repo.js";
import {emptyMentionSnapshot, emptyMentionTables, forcedActivation, runPin} from "./agent-run-repo.testlib.js";

describe("AgentRunRepo — claimNext 领取与接管", () => {
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
          run_pin: runPin,
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
          stage: "understanding",
          run_pin: runPin,
          lease_expires_at: new Date("2026-07-29T00:00:30.000Z"),
        }),
      },
      conversation_messages: {
        findMany: vi.fn().mockImplementation(({ where }) =>
          where.sequence_no.gt !== undefined
            ? [
                { id: 20n, role: "user", content: "第一条", sequence_no: 1 },
                { id: 21n, role: "user", content: "第二条", sequence_no: 2 },
              ]
            : [],
        ),
      },
      ...emptyMentionTables(),
      agent_advances: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 30n,
          ordinal: 1,
          input_high_watermark_sequence_no: 2,
          input_snapshot: [
            {
              message_id: "20",
              sequence_no: 1,
              role: "user",
              content: "第一条",
            },
            {
              message_id: "21",
              sequence_no: 2,
              role: "user",
              content: "第二条",
            },
          ],
          mention_input_snapshot: emptyMentionSnapshot,
        }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 1n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 11n,
          gmt_create: now,
          ...data,
        })),
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
        agent_run_id: "9",
        advance_id: "30",
        fencing_token: "1",
        run_version: 1,
        input_high_watermark_sequence_no: 2,
        history_messages: [],
        prompt: "第一条\n\n第二条",
        run_pin: runPin,
      }),
    );
    expect(tx.agent_advances.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agent_run_id: 9n,
        ordinal: 1,
        input_high_watermark_sequence_no: 2,
        input_snapshot: [
          { message_id: "20", sequence_no: 1, role: "user", content: "第一条" },
          { message_id: "21", sequence_no: 2, role: "user", content: "第二条" },
        ],
      }),
    });
    expect(tx.project_events.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "agent_run.status_changed",
        payload: expect.objectContaining({
          status: "running",
          stage: "understanding",
          activated_creative_skill_versions: [],
          reasoning_summary: null,
        }),
      }),
    });
  });

  it("reuses the same frozen Advance snapshot when taking over an expired lease", async () => {
    const now = new Date("2026-07-29T00:01:00.000Z");
    const snapshot = [
      { message_id: "20", sequence_no: 1, role: "user", content: "冻结输入" },
    ];
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 9n,
          status: "running",
          version: 1,
          lease_expires_at: new Date("2026-07-29T00:00:30.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 9n,
          project_id: 42n,
          conversation_id: 7n,
          user_id: 100n,
          version: 2,
          fencing_token: 2n,
          input_sequence_no: 0,
          stage: "alignment",
          run_pin: runPin,
        }),
      },
      agent_advances: {
        findFirst: vi.fn().mockResolvedValue({
          id: 30n,
          ordinal: 1,
          status: "running",
          input_snapshot: snapshot,
          input_high_watermark_sequence_no: 1,
          mention_input_snapshot: emptyMentionSnapshot,
        }),
        create: vi.fn(),
      },
      conversation_messages: { findMany },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 1n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 11n,
          gmt_create: now,
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).claimNext({
        workerId: "worker-2",
        leaseMs: 30_000,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        advance_id: "30",
        fencing_token: "2",
        input_messages: snapshot,
        prompt: "冻结输入",
      }),
    );
    expect(tx.agent_advances.create).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sequence_no: { lt: 1 },
        }),
      }),
    );
  });

  it("creates ordinal 2 for a resumed queued Run after its first Advance completed", async () => {
    const create = vi.fn().mockResolvedValue({
      id: 31n,
      ordinal: 2,
      input_high_watermark_sequence_no: 3,
      input_snapshot: [
        { message_id: "22", sequence_no: 3, role: "user", content: "主体：蓝鲸" },
      ],
      mention_input_snapshot: emptyMentionSnapshot,
    });
    const advancesFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ordinal: 1 });
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ db_now: new Date("2026-07-29T00:01:00.000Z") }]),
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 9n,
          status: "queued",
          version: 3,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 9n,
          project_id: 42n,
          conversation_id: 7n,
          user_id: 100n,
          version: 4,
          fencing_token: 3n,
          input_sequence_no: 2,
          stage: "alignment",
          run_pin: runPin,
        }),
      },
      agent_advances: {
        findFirst: advancesFindFirst,
        create,
      },
      conversation_messages: {
        findMany: vi.fn().mockImplementation(({ where }) =>
          where.sequence_no.gt !== undefined
            ? [
                {
                  id: 22n,
                  role: "user",
                  content: "主体：蓝鲸",
                  sequence_no: 3,
                },
              ]
            : [
                { role: "user", content: "创作：一张海报", sequence_no: 1 },
                { role: "assistant", content: "主体是什么？", sequence_no: 2 },
              ],
        ),
      },
      ...emptyMentionTables(),
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 1n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 11n,
          gmt_create: new Date("2026-07-29T00:01:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    const work = await createAgentRunRepo(prisma).claimNext({
      workerId: "worker-2",
      leaseMs: 30_000,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agent_run_id: 9n,
        ordinal: 2,
        status: "running",
        input_high_watermark_sequence_no: 3,
      }),
    });
    expect(work).toEqual(
      expect.objectContaining({
        advance_id: "31",
        prompt: "主体：蓝鲸",
        history_messages: [
          { role: "user", content: "创作：一张海报" },
          { role: "assistant", content: "主体是什么？" },
        ],
      }),
    );
  });

  it("fails a legacy active run closed when its RunPin is missing", async () => {
    const update = vi.fn().mockResolvedValue({ version: 2 });
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ db_now: new Date("2026-07-29T00:00:00.000Z") }]),
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 9n,
          status: "queued",
          version: 0,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 9n,
          project_id: 42n,
          conversation_id: 7n,
          version: 1,
          fencing_token: 1n,
          run_pin: null,
          activated_creative_skill_versions: [forcedActivation],
          reasoning_summary: null,
        }),
        update,
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
      createAgentRunRepo(prisma).claimNext({
        workerId: "worker-1",
        leaseMs: 30_000,
      }),
    ).resolves.toBeNull();
    expect(update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({
        status: "failed",
        failure_code: "runtime_pin_missing",
        active_guard: null,
      }),
    });
    expect(tx.project_events.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          status: "failed",
          activated_creative_skill_versions: [forcedActivation],
          reasoning_summary: null,
        }),
      }),
    });
  });

  it("claimNext 带出总结意图标记（IK60X1，契约 §15.2）", async () => {
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
          skill_summarize: true,
          run_pin: runPin,
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
          skill_summarize: true,
          run_pin: runPin,
          lease_expires_at: new Date("2026-07-29T00:00:30.000Z"),
        }),
      },
      conversation_messages: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 20n,
            role: "user",
            content: "总结当前对话",
            sequence_no: 1,
          },
        ]),
      },
      ...emptyMentionTables(),
      agent_advances: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 30n,
          ordinal: 1,
          input_high_watermark_sequence_no: 1,
          input_snapshot: [
            {
              message_id: "20",
              sequence_no: 1,
              role: "user",
              content: "总结当前对话",
            },
          ],
          mention_input_snapshot: emptyMentionSnapshot,
        }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 1n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 11n,
          gmt_create: now,
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    const work = await createAgentRunRepo(prisma).claimNext({
      workerId: "worker-1",
      leaseMs: 30_000,
    });

    expect(work).toEqual(
      expect.objectContaining({ agent_run_id: "9", skillSummarize: true }),
    );
  });
});
