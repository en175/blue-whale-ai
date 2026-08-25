// IK74V8：从 conversation-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import type { PrismaClient } from "@prisma/client";
import { bundledAgentRuntimeManifest } from "../../agent-runtime/src/runtime-manifest.js";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createConversationRepo } from "./conversation-repo.js";

describe("ConversationRepo.acceptMessage — 接纳与技能冻结", () => {
  it("atomically persists a sequenced message, queued run, events, and receipt", async () => {
    const skillBody = "# Poster Skill";
    const skillDigest = `sha256:${createHash("sha256").update(skillBody).digest("hex")}`;
    const tx = {
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: 42n }),
      },
      $queryRawUnsafe: vi.fn().mockImplementation((sql: string) =>
        sql.includes("FROM assets")
          ? Promise.resolve([
              {
                id: 21n,
                user_id: 100n,
                project_id: 42n,
                type: "image",
                storage_key: "private/project/42/21.png",
                content_sha256: "a".repeat(64),
                url: "https://storage.invalid/private/21.png",
                mime: "image/png",
                size: 1024n,
                width: 1200,
                height: 800,
                duration_ms: null,
                status: "normal",
                is_delete: false,
              },
            ])
          : Promise.resolve([
              {
                id: 22n,
                project_id: 42n,
                title: "开场分镜",
                summary: "蓝鲸跃出水面",
                content_markdown: "# 开场\n\n蓝鲸跃出水面。",
                version: 3,
                is_delete: 0,
              },
            ]),
      ),
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => data),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
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
      user_skill: {
        findMany: vi.fn().mockResolvedValue([{ skill_id: 11n }]),
      },
      creative_skill: {
        findMany: vi.fn().mockImplementation((args) =>
          // 官方引用候选查询返回海报技能；个人本体 auto_match 查询无命中。
          args?.where?.asset_domain === "personal"
            ? Promise.resolve([])
            : Promise.resolve([
                {
                  creative_skill_id: "official.poster",
                  name: "海报专家",
                  description: "海报排版",
                  source_skill_id: 11n,
                  active_version_id: "version.poster.1",
                  owner_user_id: 0n,
                  asset_domain: "official",
                },
              ]),
        ),
      },
      creative_skill_version: {
        findMany: vi.fn().mockResolvedValue([
          {
            creative_skill_version_id: "version.poster.1",
            creative_skill_id: "official.poster",
            display_version: "1.0.0",
            body: skillBody,
            content_digest: skillDigest,
            resource_digest: skillDigest,
            media_type: "text/markdown",
          },
        ]),
      },
      creative_skill_activation: { create: vi.fn() },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({
          id: 8n,
          conversation_id: 7n,
          project_id: 42n,
          agent_run_id: 9n,
          client_message_id: "client-1",
          role: "user",
          content: "做一张蓝鲸海报",
          sequence_no: 1,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
        }),
      },
      conversation_message_mentions: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 101n })
          .mockResolvedValueOnce({ id: 102n }),
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
    const transaction = vi.fn(async (callback) => callback(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    const result = await createConversationRepo(
      prisma,
      bundledAgentRuntimeManifest,
    ).acceptMessage({
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-1",
      requestHash: "a".repeat(64),
      clientMessageId: "client-1",
      content: "做一张蓝鲸海报",
      conversationId: null,
      replyToInputRequestId: null,
      mentions: [
        { type: "asset", asset_id: "21", display_name: "蓝鲸参考图" },
        {
          type: "scene_card",
          scene_card_id: "22",
          scene_card_version: 3,
          display_name: "开场分镜",
        },
      ],
      skillSummarize: false,
      forcedCreativeSkillId: null,
    });

    expect(result).toEqual({
      kind: "accepted",
      project_id: "42",
      conversation_id: "7",
      message_id: "8",
      agent_run_id: "9",
      cursor: expect.any(String),
      sequence_no: 1,
      mentions: [
        { mention_id: "101", index: 0, type: "asset" },
        { mention_id: "102", index: 1, type: "scene_card" },
      ],
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/FROM assets[\s\S]+ORDER BY id FOR UPDATE/),
      21n,
    );
    expect(tx.$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/FROM scene_cards[\s\S]+ORDER BY id FOR UPDATE/),
      22n,
    );
    expect(tx.conversations.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { version: { increment: 1 } },
      select: { id: true, version: true },
    });
    expect(tx.conversation_messages.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequence_no: 1,
        agent_run_id: 9n,
        content: "做一张蓝鲸海报",
      }),
    });
    expect(tx.conversation_message_mentions.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        message_id: 8n,
        conversation_id: 7n,
        project_id: 42n,
        accepted_user_id: 100n,
        mention_seq: 0,
        mention_type: "asset",
        target_id: 21n,
        display_name: "蓝鲸参考图",
        snapshot: {
          asset_type: "image",
          mime: "image/png",
          size: "1024",
          width: 1200,
          height: 800,
          duration_ms: null,
          content_sha256: "a".repeat(64),
        },
      }),
      select: { id: true },
    });
    const firstMentionData =
      tx.conversation_message_mentions.create.mock.calls[0][0].data;
    expect(firstMentionData).not.toHaveProperty("storage_key");
    expect(JSON.stringify(firstMentionData.snapshot)).not.toContain(
      "storage.invalid",
    );
    const acceptedEvent = tx.project_events.create.mock.calls.find(
      ([{ data }]) => data.event_type === "conversation.message_accepted",
    )?.[0].data;
    expect(acceptedEvent?.payload.mentions).toEqual([
      {
        mention_id: "101",
        index: 0,
        type: "asset",
        display_name: "蓝鲸参考图",
        availability: "available",
        reason: null,
      },
      {
        mention_id: "102",
        index: 1,
        type: "scene_card",
        display_name: "开场分镜",
        availability: "available",
        reason: null,
      },
    ]);
    expect(JSON.stringify(acceptedEvent?.payload)).not.toContain("snapshot");
    expect(tx.agent_runs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversation_id: 7n,
        active_guard: 7n,
        status: "queued",
        run_pin: expect.objectContaining({
          manifest_digest: bundledAgentRuntimeManifest.manifest_digest,
          // 技能只在用户显式点选时生效（IKB1WA）：user_skill.auto=1 也不再
          // 产生候选，更不会被服务端自动激活。
          auto_creative_skill_candidates: [],
          activated_creative_skill_versions: [],
        }),
      }),
    });
    expect(tx.creative_skill_activation.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        project_id: 42n,
        operation: "conversation.message.accept",
        idempotency_key: "cmd-1",
        accepted_cursor: expect.any(BigInt),
      }),
    });
    // 候选查询本身已下线，不再打 creative_skill 表找 auto 技能。
    expect(tx.creative_skill.findMany).not.toHaveBeenCalled();
  });

  it("freezes one authorized forced Skill and records its activation in the transaction", async () => {
    const skillBody = "# Personal Storyboard";
    const skillDigest = `sha256:${createHash("sha256").update(skillBody).digest("hex")}`;
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
          conversation_id: 7n,
          status: "queued",
          stage: "understanding",
          version: 0,
        }),
      },
      creative_skill: {
        findFirst: vi.fn().mockResolvedValue({
          creative_skill_id: "personal.storyboard",
          name: "我的分镜",
          description: null,
          active_version_id: "version.storyboard.1",
          owner_user_id: 100n,
          asset_domain: "personal",
        }),
      },
      creative_skill_version: {
        findFirst: vi.fn().mockResolvedValue({
          creative_skill_version_id: "version.storyboard.1",
          creative_skill_id: "personal.storyboard",
          display_version: "1.0.0",
          body: skillBody,
          content_digest: skillDigest,
          resource_digest: skillDigest,
          media_type: "text/markdown",
        }),
      },
      creative_skill_activation: { create: vi.fn() },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({ id: 8n }),
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
          gmt_create: new Date("2026-08-04T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    const result = await createConversationRepo(
      prisma,
      bundledAgentRuntimeManifest,
    ).acceptMessage({
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-forced",
      requestHash: "f".repeat(64),
      clientMessageId: "client-forced",
      content: "使用我的分镜",
      conversationId: "7",
      replyToInputRequestId: null,
      forcedCreativeSkillId: "personal.storyboard",
    });

    expect(result.kind).toBe("accepted");
    expect(tx.creative_skill.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        creative_skill_id: "personal.storyboard",
        OR: expect.arrayContaining([
          { asset_domain: "personal", owner_user_id: 100n },
        ]),
      }),
    });
    expect(tx.agent_runs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        run_pin: expect.objectContaining({
          auto_creative_skill_candidates: [],
          activated_creative_skill_versions: [
            expect.objectContaining({
              creative_skill_version_id: "version.storyboard.1",
              source: "forced_use",
              reason: { type: "user_use" },
            }),
          ],
        }),
      }),
    });
    expect(tx.creative_skill_activation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creative_skill_id: "personal.storyboard",
        user_id: 100n,
        agent_run_id: "9",
        activation_source: "forced",
      }),
    });
  });

  it("个人技能 auto_match=1 也不进入候选、不被激活（IKB1WA）", async () => {
    const skillBody = "# My Storyboard";
    const skillDigest = `sha256:${createHash("sha256").update(skillBody).digest("hex")}`;
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 1 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 9n,
          conversation_id: 7n,
          status: "queued",
          stage: "understanding",
          version: 0,
        }),
      },
      user_skill: { findMany: vi.fn().mockResolvedValue([]) },
      creative_skill: {
        findMany: vi.fn().mockImplementation((args) =>
          args?.where?.asset_domain === "personal"
            ? Promise.resolve([
                {
                  creative_skill_id: "personal.storyboard",
                  name: "我的分镜",
                  description: null,
                  source_skill_id: null,
                  active_version_id: "version.storyboard.1",
                  owner_user_id: 100n,
                  asset_domain: "personal",
                },
              ])
            : Promise.resolve([]),
        ),
      },
      creative_skill_version: {
        findMany: vi.fn().mockResolvedValue([
          {
            creative_skill_version_id: "version.storyboard.1",
            creative_skill_id: "personal.storyboard",
            display_version: "2.1.0",
            body: skillBody,
            content_digest: skillDigest,
            resource_digest: skillDigest,
            media_type: "text/markdown",
          },
        ]),
      },
      creative_skill_activation: { create: vi.fn() },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({ id: 8n }),
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
          gmt_create: new Date("2026-08-04T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    const result = await createConversationRepo(
      prisma,
      bundledAgentRuntimeManifest,
    ).acceptMessage({
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-auto-personal",
      requestHash: "b".repeat(64),
      clientMessageId: "client-auto-personal",
      content: "帮我做个分镜",
      conversationId: null,
      replyToInputRequestId: null,
      forcedCreativeSkillId: null,
    });

    expect(result.kind).toBe("accepted");
    // 个人本体开关不再被查询，也不再产出候选与激活埋点。
    expect(tx.creative_skill.findMany).not.toHaveBeenCalled();
    expect(tx.agent_runs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        run_pin: expect.objectContaining({
          auto_creative_skill_candidates: [],
          activated_creative_skill_versions: [],
        }),
      }),
    });
    expect(tx.creative_skill_activation.create).not.toHaveBeenCalled();
  });

  it("官方与个人 auto 开关全开，仍不激活任何技能（IKB1WA）", async () => {
    const bodyA = "# Skill A";
    const digestA = `sha256:${createHash("sha256").update(bodyA).digest("hex")}`;
    const bodyB = "# Skill B";
    const digestB = `sha256:${createHash("sha256").update(bodyB).digest("hex")}`;
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 1 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 9n,
          conversation_id: 7n,
          status: "queued",
          stage: "understanding",
          version: 0,
        }),
      },
      user_skill: {
        findMany: vi.fn().mockResolvedValue([{ skill_id: 11n }]),
      },
      creative_skill: {
        findMany: vi.fn().mockImplementation((args) =>
          args?.where?.asset_domain === "personal"
            ? Promise.resolve([
                {
                  creative_skill_id: "personal.b_skill",
                  name: "技能B",
                  description: null,
                  source_skill_id: null,
                  active_version_id: "version.b.1",
                  owner_user_id: 100n,
                  asset_domain: "personal",
                },
              ])
            : Promise.resolve([
                {
                  creative_skill_id: "official.a_skill",
                  name: "技能A",
                  description: null,
                  source_skill_id: 11n,
                  active_version_id: "version.a.1",
                  owner_user_id: 0n,
                  asset_domain: "official",
                },
              ]),
        ),
      },
      creative_skill_version: {
        findMany: vi.fn().mockResolvedValue([
          {
            creative_skill_version_id: "version.a.1",
            creative_skill_id: "official.a_skill",
            display_version: "1.0.0",
            body: bodyA,
            content_digest: digestA,
            resource_digest: digestA,
            media_type: "text/markdown",
          },
          {
            creative_skill_version_id: "version.b.1",
            creative_skill_id: "personal.b_skill",
            display_version: "1.0.0",
            body: bodyB,
            content_digest: digestB,
            resource_digest: digestB,
            media_type: "text/markdown",
          },
        ]),
      },
      creative_skill_activation: { create: vi.fn() },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({ id: 8n }),
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
          gmt_create: new Date("2026-08-04T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    const result = await createConversationRepo(
      prisma,
      bundledAgentRuntimeManifest,
    ).acceptMessage({
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-auto-multi",
      requestHash: "c".repeat(64),
      clientMessageId: "client-auto-multi",
      content: "随便做点什么",
      conversationId: null,
      replyToInputRequestId: null,
      forcedCreativeSkillId: null,
    });

    expect(result.kind).toBe("accepted");
    const runCreate = tx.agent_runs.create.mock.calls[0][0];
    const pin = runCreate.data.run_pin;
    // 两侧开关全开，候选与激活仍恒为空——只有显式点选才让技能生效。
    expect(pin.auto_creative_skill_candidates).toHaveLength(0);
    expect(pin.activated_creative_skill_versions).toHaveLength(0);
    expect(tx.creative_skill_activation.create).not.toHaveBeenCalled();
  });
});
