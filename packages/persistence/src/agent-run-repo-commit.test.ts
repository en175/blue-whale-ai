// IK74V8：从 agent-run-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import type {PrismaClient} from "@prisma/client";
import {describe, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";

import {createAgentRunRepo} from "./agent-run-repo.js";
import {emptyMentionSnapshot, requestDigest, runPin, runPinSource, signRunPin} from "./agent-run-repo.testlib.js";

describe("AgentRunRepo — RunCommit 成功路径与租约", () => {
  it("rejects a late commit whose lease owner, fence, or version no longer matches", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
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
            findUnique: vi.fn().mockResolvedValue({ id: 9n, run_pin: runPin }),
            updateMany,
          },
        }),
      ),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitSuccess({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "1",
        runVersion: 1,
        requestDigest,
        content: "完成",
        reasoningSummary: "已完成回答。",
        autoCreativeSkillActivation: null,
      }),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("replays the first RunCommit receipt for the same digest and rejects a different digest", async () => {
    const existing = {
      request_digest: requestDigest,
      receipt: { cursor: "88", status: "completed" },
    };
    const findUnique = vi.fn().mockResolvedValue(existing);
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback({ run_commits: { findUnique } }),
      ),
    } as unknown as PrismaClient;
    const repo = createAgentRunRepo(prisma);
    const command = {
      workerId: "worker-1",
      agentRunId: "9",
      advanceId: "30",
      fence: "1",
      runVersion: 1,
      requestDigest,
      content: "完成",
      reasoningSummary: "已完成回答。",
      autoCreativeSkillActivation: null,
    };

    await expect(repo.commitSuccess(command)).resolves.toEqual({
      kind: "replayed",
      cursor: "88",
      status: "completed",
    });
    await expect(
      repo.commitSuccess({
        ...command,
        requestDigest: `sha256:${"e".repeat(64)}`,
      }),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("commitPlanMessages replays a matching receipt and conflicts on a different digest (IK67H6)", async () => {
    const existing = {
      request_digest: requestDigest,
      receipt: { cursor: "91", status: "completed" },
    };
    const findUnique = vi.fn().mockResolvedValue(existing);
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback({ run_commits: { findUnique } }),
      ),
    } as unknown as PrismaClient;
    const repo = createAgentRunRepo(prisma);
    const command = {
      workerId: "worker-1",
      agentRunId: "9",
      advanceId: "30",
      fence: "1",
      runVersion: 1,
      requestDigest,
      reasoningSummary: "需求已确认，提交计划卡。",
      planCards: [
        {
          application_kind: "image_generate" as const,
          title: "海报主视觉",
          content_markdown: "一只冲浪的蓝鲸",
        },
      ],
      capabilitySnapshotVersion: 1 as const,
    };

    await expect(repo.commitPlanMessages(command)).resolves.toEqual({
      kind: "replayed",
      cursor: "91",
      status: "completed",
    });
    await expect(
      repo.commitPlanMessages({
        ...command,
        requestDigest: `sha256:${"e".repeat(64)}`,
      }),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("commitPlanMessages atomically fails an invalid batch with zero plan rows (IK67H6 AC#2)", async () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const runRow = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      status: "running",
      version: 1,
      run_pin: runPin,
      input_sequence_no: 1,
    };
    const runUpdate = vi
      .fn()
      .mockResolvedValue({ ...runRow, status: "failed", version: 2 });
    const conversationsCreate = vi.fn();
    const planMessagesCreate = vi.fn();
    const commitsCreate = vi.fn().mockResolvedValue({});
    const advancesUpdate = vi.fn().mockResolvedValue({ id: 30n });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
      run_commits: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: commitsCreate,
      },
      agent_advances: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 30n, agent_run_id: 9n }),
        update: advancesUpdate,
      },
      agent_runs: {
        findUnique: vi.fn().mockResolvedValue(runRow),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: runUpdate,
      },
      agent_provisional_deliveries: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      project_events: {
        create: vi
          .fn()
          .mockImplementation(({ data }) => ({
            id: 12n,
            gmt_create: now,
            ...data,
          })),
      },
      conversations: { update: vi.fn() },
      conversation_messages: { create: conversationsCreate },
      plan_messages: { create: planMessagesCreate },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitPlanMessages({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "1",
        runVersion: 1,
        requestDigest,
        reasoningSummary: "需求已确认，提交计划卡。",
        planCards: [
          {
            application_kind: "image_generate" as const,
            title: "海报主视觉",
            content_markdown: "一只冲浪的蓝鲸",
          },
          {
            application_kind: "scene_card_replace" as const,
            title: "覆盖场景卡",
            content_markdown: "替换后的场景描述",
            target_scene_card_mention_id: "55",
          },
        ],
        capabilitySnapshotVersion: 1 as const,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ kind: "committed", status: "failed" }),
    );
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          failure_code: "plan_card_validation_failed",
        }),
      }),
    );
    expect(conversationsCreate).not.toHaveBeenCalled();
    expect(planMessagesCreate).not.toHaveBeenCalled();
    expect(advancesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } }),
    );
    expect(commitsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "failed" }),
      }),
    );
  });

  it("commitPlanMessages fails a batch whose lineage pointer misses an existing plan message (IK67H6)", async () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const runRow = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      status: "running",
      version: 1,
      run_pin: runPin,
      input_sequence_no: 1,
    };
    const runUpdate = vi
      .fn()
      .mockResolvedValue({ ...runRow, status: "failed", version: 2 });
    const planMessagesFindMany = vi.fn().mockResolvedValue([]);
    const conversationsCreate = vi.fn();
    const planMessagesCreate = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ db_now: now }]),
      run_commits: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      agent_advances: {
        findUnique: vi.fn().mockResolvedValue({
          id: 30n,
          agent_run_id: 9n,
          mention_input_snapshot: emptyMentionSnapshot,
        }),
        update: vi.fn().mockResolvedValue({ id: 30n }),
      },
      agent_runs: {
        findUnique: vi.fn().mockResolvedValue(runRow),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: runUpdate,
      },
      agent_provisional_deliveries: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      project_events: {
        create: vi
          .fn()
          .mockImplementation(({ data }) => ({
            id: 13n,
            gmt_create: now,
            ...data,
          })),
      },
      conversation_message_mentions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      plan_messages: {
        findMany: planMessagesFindMany,
        create: planMessagesCreate,
      },
      conversations: { update: vi.fn() },
      conversation_messages: { create: conversationsCreate },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createAgentRunRepo(prisma).commitPlanMessages({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "1",
        runVersion: 1,
        requestDigest,
        reasoningSummary: "需求已确认，提交计划卡。",
        planCards: [
          {
            application_kind: "image_generate" as const,
            title: "海报主视觉",
            content_markdown: "一只冲浪的蓝鲸",
            source_plan_message_id: "999",
          },
        ],
        capabilitySnapshotVersion: 1 as const,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ kind: "committed", status: "failed" }),
    );
    expect(planMessagesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [999n] } },
      }),
    );
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failure_code: "plan_card_validation_failed",
        }),
      }),
    );
    expect(conversationsCreate).not.toHaveBeenCalled();
    expect(planMessagesCreate).not.toHaveBeenCalled();
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
      run_pin: runPin,
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
        advanceId: "30",
        fence: "1",
        runVersion: 1,
        requestDigest,
        content: "完成",
        reasoningSummary: "已完成回答。",
        autoCreativeSkillActivation: null,
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
        activated_creative_skill_versions: [],
        reasoning_summary: "已完成回答。",
      }),
    });
    expect(tx.run_commits.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        advance_id: 30n,
        request_digest: requestDigest,
        outcome: "completed",
      }),
    });
  });

  it("rebuilds auto activation metadata from the frozen candidate", async () => {
    const body = "# Frozen poster skill";
    const skillDigest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    const candidate = {
      creative_skill_id: "official.poster",
      creative_skill_version_id: "version.poster.1",
      name: "海报专家",
      description: null,
      display_version: "1.0.0",
      resource_digest: skillDigest,
    };
    const autoPin = signRunPin({
      ...runPinSource,
      auto_creative_skill_candidates: [candidate],
      creative_skill_resources: [
        {
          ...candidate,
          media_type: "text/markdown",
          body,
          content_digest: skillDigest,
        },
      ],
    });
    const run = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      version: 2,
      run_pin: autoPin,
    };
    const update = vi.fn().mockResolvedValue({
      ...run,
      status: "completed",
      stage: "completed",
      version: 3,
    });
    const createActivation = vi.fn();
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ db_now: new Date("2026-07-29T00:00:10.000Z") }]),
      agent_runs: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(run),
        update,
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
        create: vi.fn().mockResolvedValue({ id: 10n }),
      },
      conversations: {
        update: vi.fn().mockResolvedValue({ version: 3 }),
      },
      creative_skill_activation: { create: createActivation },
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
        advanceId: "30",
        fence: "1",
        runVersion: 1,
        requestDigest,
        content: "完成",
        reasoningSummary: "已使用技能完成回答。",
        autoCreativeSkillActivation: {
          creative_skill_id: candidate.creative_skill_id,
          creative_skill_version_id: candidate.creative_skill_version_id,
          name: "伪造名称",
          display_version: "9.0.0",
          resource_digest: candidate.resource_digest,
          source: "auto",
          reason: {
            type: "agent_match",
            detail: { matched_fields: ["conversation_messages"] },
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ kind: "committed", status: "completed" }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({
        activated_creative_skill_versions: [
          expect.objectContaining({
            name: "海报专家",
            display_version: "1.0.0",
          }),
        ],
      }),
    });
    expect(createActivation).toHaveBeenCalledWith({
      data: expect.objectContaining({ skill_version: 1 }),
    });
  });

  it("服务端接纳缝已固定的 auto 激活，commit 时不重复写激活埋点（§16.2）", async () => {
    const body = "# Frozen poster skill";
    const skillDigest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    const activation = {
      creative_skill_id: "official.poster",
      creative_skill_version_id: "version.poster.1",
      name: "海报专家",
      display_version: "1.0.0",
      resource_digest: skillDigest,
      source: "auto" as const,
      reason: {
        type: "agent_match" as const,
        detail: { matched_fields: ["conversation_messages" as const] },
      },
    };
    const pinnedPin = signRunPin({
      ...runPinSource,
      auto_creative_skill_candidates: [
        {
          creative_skill_id: activation.creative_skill_id,
          creative_skill_version_id: activation.creative_skill_version_id,
          name: activation.name,
          description: null,
          display_version: activation.display_version,
          resource_digest: activation.resource_digest,
        },
      ],
      activated_creative_skill_versions: [activation],
      creative_skill_resources: [
        {
          creative_skill_id: activation.creative_skill_id,
          creative_skill_version_id: activation.creative_skill_version_id,
          name: activation.name,
          description: null,
          display_version: activation.display_version,
          resource_digest: activation.resource_digest,
          media_type: "text/markdown" as const,
          body,
          content_digest: skillDigest,
        },
      ],
    });
    const run = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      version: 2,
      run_pin: pinnedPin,
    };
    const update = vi.fn().mockResolvedValue({
      ...run,
      status: "completed",
      stage: "completed",
      version: 3,
    });
    const createActivation = vi.fn();
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ db_now: new Date("2026-07-29T00:00:10.000Z") }]),
      agent_runs: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(run),
        update,
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
        create: vi.fn().mockResolvedValue({ id: 10n }),
      },
      conversations: {
        update: vi.fn().mockResolvedValue({ version: 3 }),
      },
      creative_skill_activation: { create: createActivation },
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
        advanceId: "30",
        fence: "1",
        runVersion: 1,
        requestDigest,
        content: "完成",
        reasoningSummary: "已使用技能完成回答。",
        autoCreativeSkillActivation: null,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ kind: "committed", status: "completed" }),
    );
    // 已固定激活随 commit 保留；埋点不重复写（接纳缝已落一行）。
    expect(update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({
        activated_creative_skill_versions: [
          expect.objectContaining({
            creative_skill_id: "official.poster",
            source: "auto",
          }),
        ],
      }),
    });
    expect(createActivation).not.toHaveBeenCalled();
  });
});
