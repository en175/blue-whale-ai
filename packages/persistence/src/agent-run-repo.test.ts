import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { bundledAgentRuntimeManifest } from "../../agent-runtime/src/runtime-manifest.js";
import {
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
} from "@blue-whale/contracts";
import { createHash } from "node:crypto";

import { createAgentRunRepo } from "./agent-run-repo.js";

const runPinSource: Omit<AgentRunPin, "pin_digest"> = {
  schema_version: 1 as const,
  manifest_id: bundledAgentRuntimeManifest.manifest_id,
  manifest_version: bundledAgentRuntimeManifest.manifest_version,
  manifest_digest: bundledAgentRuntimeManifest.manifest_digest,
  resources: structuredClone(bundledAgentRuntimeManifest.resources),
  role_resource_id: bundledAgentRuntimeManifest.role_resource_id,
  rule_resource_ids: structuredClone(
    bundledAgentRuntimeManifest.rule_resource_ids,
  ),
  runtime_skill_resource_ids: structuredClone(
    bundledAgentRuntimeManifest.runtime_skill_resource_ids,
  ),
  model_profile: structuredClone(
    bundledAgentRuntimeManifest.model_profiles[0]!,
  ),
  runtime_budget_policy: bundledAgentRuntimeManifest.runtime_budget_policy,
  tool_grants: [],
  auto_creative_skill_candidates: [],
  activated_creative_skill_versions: [],
  creative_skill_resources: [],
};
function signRunPin(source: Omit<AgentRunPin, "pin_digest">): AgentRunPin {
  return {
    ...source,
    pin_digest: `sha256:${createHash("sha256")
      .update(canonicalAgentRunPinDigestInput(source))
      .digest("hex")}`,
  };
}

const runPin = signRunPin(runPinSource);
const requestDigest = `sha256:${"d".repeat(64)}`;

/** claimNext 冻结 MentionInputSnapshot 时读取的 mention 事实表（T08）。
 *  默认无 mention —— freezeMentionInputSnapshot 产出空快照。 */
function emptyMentionTables() {
  return {
    conversation_message_mentions: { findMany: vi.fn().mockResolvedValue([]) },
    assets: { findMany: vi.fn().mockResolvedValue([]) },
    scene_cards: { findMany: vi.fn().mockResolvedValue([]) },
  };
}
const emptyMentionSnapshot = { capability_snapshot_version: 1, entries: [] };
const forcedActivation = {
  creative_skill_id: "official.poster",
  creative_skill_version_id: "version.poster.1",
  name: "海报专家",
  display_version: "1.0.0",
  resource_digest: `sha256:${"a".repeat(64)}`,
  source: "forced_use" as const,
  reason: { type: "user_use" as const },
};

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
