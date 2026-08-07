// IK74V8：从 conversation-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import type {PrismaClient} from "@prisma/client";
import {bundledAgentRuntimeManifest} from "../../agent-runtime/src/runtime-manifest.js";
import {describe, expect, it, vi} from "vitest";

import {createConversationRepo} from "./conversation-repo.js";

describe("ConversationRepo.acceptMessage — 幂等、并发与闸门", () => {
  it("rejects a forced Skill on an already-active run before writing the message", async () => {
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: { findUnique: vi.fn().mockResolvedValue(null) },
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 9n,
          conversation_id: 7n,
          active_guard: 7n,
          status: "running",
          version: 1,
        }),
        updateMany: vi.fn(),
      },
      conversation_messages: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createConversationRepo(prisma, bundledAgentRuntimeManifest).acceptMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-conflict",
          requestHash: "e".repeat(64),
          clientMessageId: "client-conflict",
          content: "改用这个技能",
          conversationId: "7",
          replyToInputRequestId: null,
          forcedCreativeSkillId: "official.poster",
        },
      ),
    ).resolves.toEqual({ kind: "creative_skill_conflict" });
    expect(tx.agent_runs.updateMany).not.toHaveBeenCalled();
    expect(tx.conversation_messages.create).not.toHaveBeenCalled();
  });

  it("does not create a conversation when a forced Skill is unavailable", async () => {
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: { findUnique: vi.fn().mockResolvedValue(null) },
      conversations: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
      },
      agent_runs: { findFirst: vi.fn().mockResolvedValue(null) },
      creative_skill: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createConversationRepo(prisma, bundledAgentRuntimeManifest).acceptMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-unavailable",
          requestHash: "d".repeat(64),
          clientMessageId: "client-unavailable",
          content: "使用不存在的技能",
          conversationId: null,
          replyToInputRequestId: null,
          forcedCreativeSkillId: "missing.skill",
        },
      ),
    ).resolves.toEqual({ kind: "creative_skill_unavailable" });
    expect(tx.conversations.create).not.toHaveBeenCalled();
  });

  it("returns the first receipt for an identical replay and rejects a changed request", async () => {
    const receipt = {
      request_hash: "a".repeat(64),
      message_id: 8n,
      agent_run_id: 9n,
      resource_id: 7n,
      accepted_cursor: 2n,
    };
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: { findUnique: vi.fn().mockResolvedValue(receipt) },
      conversation_messages: {
        findUnique: vi.fn().mockResolvedValue({ sequence_no: 1 }),
      },
      conversation_message_mentions: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 101n, mention_seq: 0, mention_type: "asset" },
          ]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;
    const repo = createConversationRepo(prisma, bundledAgentRuntimeManifest);
    const base = {
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-1",
      requestHash: "a".repeat(64),
      clientMessageId: "client-1",
      content: "做一张蓝鲸海报",
      conversationId: null,
      replyToInputRequestId: null,
      skillSummarize: false,
    };

    await expect(repo.acceptMessage(base)).resolves.toEqual({
      kind: "replayed",
      project_id: "42",
      conversation_id: "7",
      message_id: "8",
      agent_run_id: "9",
      cursor: "2",
      sequence_no: 1,
      mentions: [{ mention_id: "101", index: 0, type: "asset" }],
    });
    await expect(
      repo.acceptMessage({ ...base, requestHash: "b".repeat(64) }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
  });

  it("retries the transaction after a concurrent idempotency unique conflict", async () => {
    const replayed = {
      kind: "replayed",
      project_id: "42",
      conversation_id: "7",
      message_id: "8",
      agent_run_id: "9",
      cursor: "2",
      sequence_no: 1,
      mentions: [],
    } as const;
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce(replayed);
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await expect(
      createConversationRepo(prisma, bundledAgentRuntimeManifest).acceptMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-1",
          requestHash: "a".repeat(64),
          clientMessageId: "client-1",
          content: "蓝鲸海报",
          conversationId: null,
          replyToInputRequestId: null,
          skillSummarize: false,
        },
      ),
    ).resolves.toEqual(replayed);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("rejects a later message once the sole Advance is already running", async () => {
    const running = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      active_guard: 7n,
      status: "running",
      stage: "responding",
      version: 3,
    };
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 2 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(running),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(running),
        create: vi.fn(),
      },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({
          id: 10n,
          conversation_id: 7n,
          project_id: 42n,
          agent_run_id: 9n,
          role: "user",
          content: "再加一只蓝鲸",
          sequence_no: 2,
        }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 3n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 3n,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createConversationRepo(prisma, bundledAgentRuntimeManifest).acceptMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-2",
          requestHash: "b".repeat(64),
          clientMessageId: "client-2",
          content: "再加一只蓝鲸",
          conversationId: "7",
          replyToInputRequestId: null,
          skillSummarize: false,
        },
      ),
    ).resolves.toEqual({ kind: "agent_run_conflict" });

    expect(tx.agent_runs.updateMany).not.toHaveBeenCalled();
    expect(tx.conversation_messages.create).not.toHaveBeenCalled();
    expect(tx.agent_runs.create).not.toHaveBeenCalled();
  });

  it("resumes an awaiting_input Run to queued when its clarification is answered", async () => {
    const run = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      active_guard: 7n,
      status: "awaiting_input",
      stage: "alignment",
      version: 2,
      activated_creative_skill_versions: null,
      reasoning_summary: null,
    };
    const createEvent = vi.fn().mockImplementation(({ data }) => ({
      id: 11n,
      gmt_create: new Date("2026-07-29T00:00:00.000Z"),
      ...data,
    }));
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 2 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(run),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          ...run,
          status: "queued",
          version: 3,
        }),
      },
      user_input_requests: {
        findFirst: vi.fn().mockResolvedValue({
          id: 12n,
          source_agent_run_id: 9n,
        }),
        update: vi.fn(),
      },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({
          id: 10n,
          conversation_id: 7n,
          project_id: 42n,
          agent_run_id: 9n,
          role: "user",
          content: "极简风格",
          sequence_no: 2,
        }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 4n }),
      },
      project_events: { create: createEvent },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createConversationRepo(prisma, bundledAgentRuntimeManifest).acceptMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-answer",
          requestHash: "c".repeat(64),
          clientMessageId: "client-answer",
          content: "极简风格",
          conversationId: "7",
          replyToInputRequestId: "12",
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "accepted",
        agent_run_id: "9",
        message_id: "10",
        sequence_no: 2,
      }),
    );
    expect(tx.agent_runs.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 9n,
        status: "awaiting_input",
        version: 2,
      }),
      data: expect.objectContaining({
        status: "queued",
        version: { increment: 1 },
      }),
    });
    expect(tx.user_input_requests.update).toHaveBeenCalledWith({
      where: { id: 12n },
      data: expect.objectContaining({
        status: "answered",
        resumed_agent_run_id: 9n,
        answer_message_id: 10n,
      }),
    });
    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "agent_run.status_changed",
        payload: expect.objectContaining({ status: "queued" }),
      }),
    });
  });

  // 总结当前对话意图持久化（IK60X1，契约 §15.2）：接纳 skill_summarize=true 的消息
  // 把所属 agent_runs 行打上总结意图标记——新建 Run 直接置位，复用活动 Run 随 updateMany 置位。
  it("新建 Run 时按本条消息意图写入 skill_summarize", async () => {
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 1 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 9n,
          project_id: 42n,
          conversation_id: 7n,
          active_guard: 7n,
          status: "queued",
          stage: "understanding",
          version: 0,
        }),
      },
      user_skill: { findMany: vi.fn().mockResolvedValue([]) },
      creative_skill: { findMany: vi.fn().mockResolvedValue([]) },
      creative_skill_version: { findMany: vi.fn().mockResolvedValue([]) },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({ id: 8n, sequence_no: 1 }),
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
          id: 1n,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await createConversationRepo(
      prisma,
      bundledAgentRuntimeManifest,
    ).acceptMessage({
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-sum",
      requestHash: "d".repeat(64),
      clientMessageId: "client-sum",
      content: "总结当前对话并保存为我的技能",
      conversationId: "7",
      replyToInputRequestId: null,
      skillSummarize: true,
    });

    expect(tx.agent_runs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ skill_summarize: true }),
    });
  });

  it("运行中的单 Advance 拒绝追加总结意图", async () => {
    const running = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      active_guard: 7n,
      status: "running",
      stage: "responding",
      version: 3,
    };
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 2 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(running),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(running),
        create: vi.fn(),
      },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({ id: 10n, sequence_no: 2 }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 3n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 3n,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createConversationRepo(prisma, bundledAgentRuntimeManifest).acceptMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-sum-2",
          requestHash: "e".repeat(64),
          clientMessageId: "client-sum-2",
          content: "总结当前对话并保存为我的技能",
          conversationId: "7",
          replyToInputRequestId: null,
          skillSummarize: true,
        },
      ),
    ).resolves.toEqual({ kind: "agent_run_conflict" });

    expect(tx.agent_runs.updateMany).not.toHaveBeenCalled();
    expect(tx.conversation_messages.create).not.toHaveBeenCalled();
    expect(tx.agent_runs.create).not.toHaveBeenCalled();
  });

  it("rejects every unavailable mention before any conversation, run, message, event, or receipt write", async () => {
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      $queryRawUnsafe: vi.fn().mockImplementation((sql: string) =>
        sql.includes("FROM assets")
          ? Promise.resolve([
              {
                id: 20n,
                user_id: 100n,
                project_id: 42n,
                status: "normal",
                is_delete: false,
              },
              {
                id: 21n,
                user_id: 999n,
                project_id: 42n,
                status: "normal",
                is_delete: false,
              },
            ])
          : Promise.resolve([
              { id: 30n, project_id: 42n, version: 4, is_delete: 0 },
              { id: 31n, project_id: 77n, version: 1, is_delete: 0 },
            ]),
      ),
      conversations: { findFirst: vi.fn(), create: vi.fn() },
      agent_runs: { findFirst: vi.fn(), create: vi.fn() },
      conversation_messages: { create: vi.fn() },
      conversation_message_mentions: { create: vi.fn() },
      project_events: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createConversationRepo(prisma, bundledAgentRuntimeManifest).acceptMessage(
        {
          userId: "100",
          projectId: "42",
          idempotencyKey: "cmd-invalid-mentions",
          requestHash: "f".repeat(64),
          clientMessageId: "client-invalid-mentions",
          content: "引用这些素材",
          conversationId: null,
          replyToInputRequestId: null,
          mentions: [
            { type: "asset", asset_id: "20", display_name: "有效素材" },
            { type: "asset", asset_id: "21", display_name: "他人素材" },
            {
              type: "scene_card",
              scene_card_id: "30",
              scene_card_version: 3,
              display_name: "旧版分镜",
            },
            {
              type: "scene_card",
              scene_card_id: "31",
              scene_card_version: 1,
              display_name: "其他项目分镜",
            },
            {
              type: "scene_card",
              scene_card_id: "32",
              scene_card_version: 1,
              display_name: "已删除分镜",
            },
          ],
        },
      ),
    ).resolves.toEqual({
      kind: "mention_unavailable",
      mentions: [
        { index: 1, type: "asset", reason: "permission_lost" },
        { index: 2, type: "scene_card", reason: "stale" },
        { index: 3, type: "scene_card", reason: "wrong_project" },
        { index: 4, type: "scene_card", reason: "deleted" },
      ],
    });
    expect(tx.conversations.findFirst).not.toHaveBeenCalled();
    expect(tx.conversations.create).not.toHaveBeenCalled();
    expect(tx.agent_runs.create).not.toHaveBeenCalled();
    expect(tx.conversation_messages.create).not.toHaveBeenCalled();
    expect(tx.conversation_message_mentions.create).not.toHaveBeenCalled();
    expect(tx.project_events.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
    expect(tx.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/FROM assets[\s\S]+ORDER BY id FOR UPDATE/),
      20n,
      21n,
    );
    expect(tx.$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/FROM scene_cards[\s\S]+ORDER BY id FOR UPDATE/),
      30n,
      31n,
      32n,
    );
  });
});
