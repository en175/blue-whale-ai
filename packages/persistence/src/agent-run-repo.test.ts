// IK74V8：从 agent-run-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import type {PrismaClient} from "@prisma/client";
import {describe, expect, it, vi} from "vitest";

import {createAgentRunRepo} from "./agent-run-repo.js";
import {requestDigest, runPin} from "./agent-run-repo.testlib.js";

describe("AgentRunRepo — 终态提交与 mention 闸门", () => {
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
      agent_advances: {
        findUnique: vi.fn().mockResolvedValue({
          id: 30n,
          agent_run_id: 9n,
          input_high_watermark_sequence_no: 2,
        }),
        update: vi.fn(),
      },
      agent_provisional_deliveries: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      run_commits: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
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
        advanceId: "30",
        fence: "1",
        runVersion: 1,
        requestDigest,
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
    expect(tx.project_events.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "agent_run.status_changed",
        payload: expect.objectContaining({
          status: "failed",
          activated_creative_skill_versions: [],
          reasoning_summary: null,
        }),
      }),
    });
  });

  it("rejects a late failure commit whose fence or version no longer matches", async () => {
    const now = new Date("2026-07-29T00:00:10.000Z");
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback({
          $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
          run_commits: { findUnique: vi.fn().mockResolvedValue(null) },
          agent_advances: {
            findUnique: vi.fn().mockResolvedValue({
              id: 30n,
              agent_run_id: 9n,
              input_high_watermark_sequence_no: 2,
            }),
          },
          agent_runs: {
            findUnique: vi.fn().mockResolvedValue({ id: 9n }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
        }),
      ),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitFailure({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "1",
        runVersion: 1,
        requestDigest,
        failureCode: "runtime_error",
        failureMessage: "boom",
      }),
    ).resolves.toEqual({ kind: "conflict" });
  });

  function awaitingInputTx(overrides: {
    activeRequest?: { id: bigint } | null;
  }) {
    const run = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      status: "running",
      stage: "understanding",
      version: 2,
      fencing_token: 1n,
      input_sequence_no: 0,
      activated_creative_skill_versions: null,
      reasoning_summary: null,
    };
    const now = new Date("2026-07-29T00:00:10.000Z");
    return {
      run,
      tx: {
        $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
        run_commits: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        agent_advances: {
          findUnique: vi.fn().mockResolvedValue({
            id: 30n,
            agent_run_id: 9n,
            input_high_watermark_sequence_no: 1,
          }),
          update: vi.fn(),
        },
        agent_provisional_deliveries: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        agent_runs: {
          findUnique: vi.fn().mockResolvedValue(run),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue({
            ...run,
            status: "awaiting_input",
            stage: "alignment",
            version: 3,
          }),
        },
        user_input_requests: {
          findFirst: vi.fn().mockResolvedValue(overrides.activeRequest ?? null),
          create: vi.fn().mockResolvedValue({ id: 77n }),
        },
        conversations: { update: vi.fn().mockResolvedValue({ version: 2 }) },
        conversation_messages: {
          create: vi.fn().mockResolvedValue({ id: 10n }),
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
      },
    };
  }

  it("commits awaiting_input with an assistant message and one pending clarification request", async () => {
    const { tx } = awaitingInputTx({ activeRequest: null });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitAwaitingInput({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "1",
        runVersion: 2,
        requestDigest,
        content: "请告诉我这次创作的主体是什么？",
        reasoningSummary: "需求缺少主体，先澄清最关键的一项。",
        question: "请告诉我这次创作的主体是什么？",
        stage: "alignment",
      }),
    ).resolves.toEqual({
      kind: "committed",
      cursor: expect.any(String),
      status: "awaiting_input",
    });
    expect(tx.conversation_messages.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        content: "请告诉我这次创作的主体是什么？",
        sequence_no: 2,
      }),
    });
    expect(tx.user_input_requests.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        request_type: "creation_clarification",
        source_agent_run_id: 9n,
        status: "pending",
        question: "请告诉我这次创作的主体是什么？",
      }),
    });
    expect(tx.agent_runs.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({
        status: "awaiting_input",
        stage: "alignment",
        input_sequence_no: 1,
        lease_owner: null,
      }),
    });
    expect(tx.run_commits.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: "awaiting_input" }),
    });
  });

  it("conflicts when the Run already holds an active input request", async () => {
    const { tx } = awaitingInputTx({ activeRequest: { id: 76n } });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitAwaitingInput({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "1",
        runVersion: 2,
        requestDigest,
        content: "再问一次",
        reasoningSummary: "重复请求。",
        question: "再问一次",
        stage: "alignment",
      }),
    ).resolves.toEqual({ kind: "conflict" });
    expect(tx.user_input_requests.create).not.toHaveBeenCalled();
    expect(tx.conversation_messages.create).not.toHaveBeenCalled();
  });

  it("commits a user-requested cancellation without an assistant message", async () => {
    const run = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      status: "running",
      stage: "alignment",
      version: 2,
      fencing_token: 1n,
      activated_creative_skill_versions: null,
      reasoning_summary: null,
    };
    const update = vi.fn().mockResolvedValue({
      ...run,
      status: "cancelled",
      stage: "cancelled",
      version: 3,
    });
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ db_now: new Date("2026-07-29T00:00:10.000Z") }]),
      run_commits: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      agent_advances: {
        findUnique: vi.fn().mockResolvedValue({
          id: 30n,
          agent_run_id: 9n,
          input_high_watermark_sequence_no: 1,
        }),
        update: vi.fn(),
      },
      agent_provisional_deliveries: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      agent_runs: {
        findUnique: vi.fn().mockResolvedValue(run),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update,
      },
      conversations: { update: vi.fn().mockResolvedValue({ version: 3 }) },
      conversation_messages: { create: vi.fn().mockResolvedValue({ id: 10n }) },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 1n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 11n,
          gmt_create: new Date("2026-07-29T00:00:10.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitCancelled({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "1",
        runVersion: 2,
        requestDigest,
        content: "好的，已按你的要求停止，不会创建计划。",
        reasoningSummary: "按 User 要求停止。",
      }),
    ).resolves.toEqual({
      kind: "committed",
      cursor: expect.any(String),
      status: "cancelled",
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({
        status: "cancelled",
        stage: "cancelled",
        terminal_reason: "user_requested",
        input_sequence_no: 1,
        active_guard: null,
      }),
    });
    expect(tx.conversation_messages.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: "assistant",
        content: "好的，已按你的要求停止，不会创建计划。",
      }),
    });
    expect(tx.run_commits.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: "cancelled" }),
    });
  });

  it("freezes a per-advance MentionInputSnapshot from current mention facts (T08, AC#1/#4)", async () => {
    const now = new Date("2026-08-04T00:00:00.000Z");
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
          lease_expires_at: new Date("2026-08-04T00:00:30.000Z"),
        }),
      },
      conversation_messages: {
        findMany: vi.fn().mockImplementation(({ where }) =>
          where.sequence_no.gt !== undefined
            ? [
                {
                  id: 20n,
                  role: "user",
                  content: "@[图] @[分镜] @[他人图]",
                  sequence_no: 1,
                },
              ]
            : [],
        ),
      },
      conversation_message_mentions: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 500n,
            mention_seq: 0,
            mention_type: "asset",
            target_id: 800n,
            target_version: null,
            accepted_user_id: 100n,
            snapshot: {
              asset_type: "image",
              mime: "image/png",
              size: "1024",
              width: 1200,
              height: 800,
              duration_ms: null,
              content_sha256: "a".repeat(64),
            },
          },
          {
            id: 501n,
            mention_seq: 1,
            mention_type: "scene_card",
            target_id: 900n,
            target_version: 3,
            accepted_user_id: 100n,
            snapshot: {
              title: "开场",
              summary: null,
              content_markdown: "# 开场",
              version: 3,
            },
          },
          {
            id: 502n,
            mention_seq: 2,
            mention_type: "asset",
            target_id: 801n,
            target_version: null,
            accepted_user_id: 100n,
            snapshot: {
              asset_type: "image",
              mime: "image/jpeg",
              size: "2048",
              width: 640,
              height: 480,
              duration_ms: null,
              content_sha256: "b".repeat(64),
            },
          },
        ]),
      },
      assets: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 800n,
            user_id: 100n,
            project_id: 42n,
            status: "normal",
            is_delete: false,
          },
          // 801 已转移给他人 → permission_lost → unavailable
          {
            id: 801n,
            user_id: 200n,
            project_id: 42n,
            status: "normal",
            is_delete: false,
          },
        ]),
      },
      scene_cards: {
        findMany: vi.fn().mockResolvedValue([
          // 版本 4 ≠ mention target_version 3 → stale（仍保留冻结历史投影）
          { id: 900n, project_id: 42n, version: 4, is_delete: 0 },
        ]),
      },
      agent_advances: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 30n,
          ordinal: 1,
          input_high_watermark_sequence_no: data.input_high_watermark_sequence_no,
          input_snapshot: data.input_snapshot,
          mention_input_snapshot: data.mention_input_snapshot,
        })),
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

    const claimed = await createAgentRunRepo(prisma).claimNext({
      workerId: "worker-1",
      leaseMs: 30_000,
    });
    const entries = claimed?.mention_input_snapshot.entries ?? [];
    expect(entries).toEqual([
      {
        mention_id: "500",
        mention_seq: 0,
        type: "asset",
        availability: "available",
        reason: null,
        projection: {
          asset_type: "image",
          mime: "image/png",
          size: "1024",
          width: 1200,
          height: 800,
          duration_ms: null,
          content_sha256: "a".repeat(64),
        },
      },
      {
        mention_id: "501",
        mention_seq: 1,
        type: "scene_card",
        availability: "stale",
        reason: "stale",
        projection: { title: "开场", summary: null, content_markdown: "# 开场", version: 3 },
      },
      {
        mention_id: "502",
        mention_seq: 2,
        type: "asset",
        availability: "unavailable",
        reason: "permission_lost",
      },
    ]);
    // 投影不得暴露存储身份/用户身份（AC#4）。
    expect(JSON.stringify(entries)).not.toContain("storage_key");
    expect(JSON.stringify(entries)).not.toMatch(/"user_id"/);
    // 快照在创建 advance 时一次性冻结（AC#1）；接管分支不重算（见 reuse 用例）。
    expect(tx.agent_advances.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mention_input_snapshot: claimed?.mention_input_snapshot,
      }),
    });
  });

  describe("recheckMentionAuthority（T08，AC#5 实时重查）", () => {
    const frozenSnapshot = {
      capability_snapshot_version: 1 as const,
      entries: [
        {
          mention_id: "500",
          mention_seq: 0,
          type: "asset" as const,
          availability: "available" as const,
          reason: null,
        },
      ],
    };

    function recheckPrisma(options: {
      mentionRows?: unknown[];
      assets?: unknown[];
      run?: unknown;
    }) {
      const tx = {
        agent_runs: {
          findUnique: vi.fn().mockResolvedValue(
            options.run ?? {
              id: 9n,
              project_id: 42n,
              user_id: 100n,
              is_delete: 0,
            },
          ),
        },
        conversation_message_mentions: {
          findMany: vi.fn().mockResolvedValue(
            options.mentionRows ?? [
              {
                id: 500n,
                mention_type: "asset",
                target_id: 800n,
                target_version: null,
                accepted_user_id: 100n,
              },
            ],
          ),
        },
        assets: { findMany: vi.fn().mockResolvedValue(options.assets ?? []) },
        scene_cards: { findMany: vi.fn().mockResolvedValue([]) },
      };
      return {
        prisma: {
          $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
            callback(tx),
          ),
        } as unknown as PrismaClient,
        tx,
      };
    }

    it("passes an empty snapshot without any database query", async () => {
      const { prisma } = recheckPrisma({});
      const result = await createAgentRunRepo(prisma).recheckMentionAuthority({
        agentRunId: "9",
        snapshot: { capability_snapshot_version: 1, entries: [] },
      });
      expect(result).toEqual({ authoritative: true });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("passes when current facts still authorize the frozen mention", async () => {
      const { prisma } = recheckPrisma({
        assets: [
          {
            id: 800n,
            user_id: 100n,
            project_id: 42n,
            status: "normal",
            is_delete: false,
          },
        ],
      });
      const result = await createAgentRunRepo(prisma).recheckMentionAuthority({
        agentRunId: "9",
        snapshot: frozenSnapshot,
      });
      expect(result).toEqual({ authoritative: true });
    });

    it("blocks after freeze when the referenced asset is deleted", async () => {
      // 冻结时 available；重查时资产已删（is_delete）→ 非权威。
      const { prisma } = recheckPrisma({
        assets: [
          {
            id: 800n,
            user_id: 100n,
            project_id: 42n,
            status: "normal",
            is_delete: true,
          },
        ],
      });
      const result = await createAgentRunRepo(prisma).recheckMentionAuthority({
        agentRunId: "9",
        snapshot: frozenSnapshot,
      });
      expect(result).toEqual({ authoritative: false });
    });

    it("blocks when the mention fact row can no longer be found", async () => {
      const { prisma } = recheckPrisma({ mentionRows: [] });
      const result = await createAgentRunRepo(prisma).recheckMentionAuthority({
        agentRunId: "9",
        snapshot: frozenSnapshot,
      });
      expect(result).toEqual({ authoritative: false });
    });
  });
});
