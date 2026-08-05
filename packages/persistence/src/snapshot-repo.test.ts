import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSnapshotRepo } from "./snapshot-repo.js";

describe("SnapshotRepo.loadJobsAndAssets", () => {
  it("does not expose the encrypted provider credential in snapshot input", async () => {
    const prisma = {
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 300n,
            type: "video",
            source: "bottom_dock",
            status: "processing",
            progress: 10,
            input: {
              prompt: "鲸鱼游动",
              provider_credential: "sealed-token",
            },
            output_asset_ids: [],
            error: null,
          },
        ]),
      },
      assets: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets(
      "55",
      "100",
    );

    expect(result.generation_jobs[0]?.input).toEqual({ prompt: "鲸鱼游动" });
  });

  it("returns normal uploaded project assets even when no generation job produced them", async () => {
    const findJobs = vi.fn().mockResolvedValue([]);
    const findAssets = vi.fn().mockResolvedValue([
      {
        id: 200n,
        project_id: 55n,
        type: "image",
        url: "tos://project/55/200.png",
      },
      {
        id: 201n,
        project_id: 55n,
        type: "image",
        url: "tos://project/55/201.png",
      },
    ]);
    const prisma = {
      generation_jobs: { findMany: findJobs },
      assets: { findMany: findAssets },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets(
      "55",
      "100",
    );

    expect(findAssets).toHaveBeenCalledTimes(1);
    expect(findAssets).toHaveBeenCalledWith({
      where: {
        project_id: 55n,
        user_id: 100n,
        status: "normal",
        is_delete: false,
      },
    });
    expect(result.assets).toEqual([
      {
        id: "200",
        project_id: "55",
        type: "image",
        url: "tos://project/55/200.png",
      },
      {
        id: "201",
        project_id: "55",
        type: "image",
        url: "tos://project/55/201.png",
      },
    ]);
  });
});

describe("SnapshotRepo.loadConversationState", () => {
  it("returns persisted messages, runs, active input requests, and the real high-watermark", async () => {
    const findInputRequests = vi.fn().mockResolvedValue([
      {
        id: 10n,
        source_agent_run_id: 9n,
        request_type: "creation_clarification",
        question: "需要什么风格？",
        status: "pending",
        expires_at: new Date("2026-07-30T00:00:00.000Z"),
      },
    ]);
    const prisma = {
      conversation_messages: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 8n,
            conversation_id: 7n,
            agent_run_id: 9n,
            role: "user",
            content: "蓝鲸海报",
            sequence_no: 1,
            gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          },
        ]),
      },
      conversation_message_mentions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      agent_runs: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 9n,
            conversation_id: 7n,
            status: "awaiting_input",
            stage: "clarifying",
            version: 2,
            run_pin: { creative_skill_resources: [{ body: "private" }] },
            activated_creative_skill_versions: [
              {
                creative_skill_id: "official.poster",
                creative_skill_version_id: "version.poster.1",
                name: "海报专家",
                display_version: "1.0.0",
                resource_digest: `sha256:${"a".repeat(64)}`,
                source: "auto",
                reason: {
                  type: "agent_match",
                  detail: { matched_fields: ["conversation_messages"] },
                },
              },
            ],
            reasoning_summary: "已使用「海报专家」完成回答。",
          },
        ]),
      },
      user_input_requests: {
        findMany: findInputRequests,
      },
      project_events: {
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _max: { cursor: 12n } }),
      },
      plan_messages: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      scene_cards: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      plan_application_receipts: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    await expect(
      createSnapshotRepo(prisma).loadConversationState("42", "100"),
    ).resolves.toEqual({
      conversation_messages: [
        expect.objectContaining({ message_id: "8", sequence_no: 1 }),
      ],
      plan_messages: [],
      scene_cards: [],
      plan_applications: [],
      agent_runs: [
        expect.objectContaining({
          agent_run_id: "9",
          active_input_request: expect.objectContaining({
            input_request_id: "10",
          }),
          activated_creative_skill_versions: [
            expect.objectContaining({
              creative_skill_id: "official.poster",
              name: "海报专家",
              source: "auto",
            }),
          ],
          reasoning_summary: "已使用「海报专家」完成回答。",
        }),
      ],
      high_watermark_cursor: "12",
    });
    const serialized = JSON.stringify(
      await createSnapshotRepo(prisma).loadConversationState("42", "100"),
    );
    expect(serialized).not.toContain("run_pin");
    expect(serialized).not.toContain("private");
    expect(findInputRequests).toHaveBeenCalledWith({
      where: {
        project_id: 42n,
        status: "pending",
        expires_at: { gt: expect.any(Date) },
        is_delete: 0,
      },
      orderBy: { id: "asc" },
    });
  });

  it("recomputes mention availability without rewriting immutable snapshots or leaking unavailable content", async () => {
    const assetFindMany = vi.fn().mockResolvedValue([
      {
        id: 1n,
        user_id: 999n,
        project_id: 42n,
        status: "normal",
        is_delete: false,
      },
      {
        id: 3n,
        user_id: 100n,
        project_id: 42n,
        status: "normal",
        is_delete: false,
      },
    ]);
    const prisma = {
      conversation_messages: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 8n,
            conversation_id: 7n,
            agent_run_id: 9n,
            role: "user",
            content: "使用这些引用",
            sequence_no: 1,
            gmt_create: new Date("2026-08-04T00:00:00.000Z"),
          },
        ]),
      },
      conversation_message_mentions: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 101n,
            message_id: 8n,
            accepted_user_id: 100n,
            mention_seq: 0,
            mention_type: "asset",
            target_id: 1n,
            target_version: null,
            display_name: "他人素材",
            snapshot: { asset_type: "image", content_sha256: "secret-a" },
          },
          {
            id: 102n,
            message_id: 8n,
            accepted_user_id: 100n,
            mention_seq: 1,
            mention_type: "scene_card",
            target_id: 2n,
            target_version: 3,
            display_name: "旧版分镜",
            snapshot: {
              title: "冻结标题",
              summary: "冻结摘要",
              content_markdown: "# 冻结正文",
              version: 3,
            },
          },
          {
            id: 103n,
            message_id: 8n,
            accepted_user_id: 100n,
            mention_seq: 2,
            mention_type: "asset",
            target_id: 3n,
            target_version: null,
            display_name: "可用素材",
            snapshot: { asset_type: "image", content_sha256: "safe-c" },
          },
        ]),
      },
      assets: { findMany: assetFindMany },
      scene_cards: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 2n, project_id: 42n, version: 4, is_delete: 0 },
          ]),
      },
      agent_runs: { findMany: vi.fn().mockResolvedValue([]) },
      user_input_requests: { findMany: vi.fn().mockResolvedValue([]) },
      project_events: {
        aggregate: vi.fn().mockResolvedValue({ _max: { cursor: 12n } }),
      },
      plan_messages: { findMany: vi.fn().mockResolvedValue([]) },
      plan_application_receipts: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const state = await createSnapshotRepo(prisma).loadConversationState(
      "42",
      "100",
    );

    expect(state.conversation_messages[0]?.mentions).toEqual([
      {
        mention_id: "101",
        index: 0,
        type: "asset",
        display_name: "他人素材",
        availability: "unavailable",
        reason: "permission_lost",
      },
      {
        mention_id: "102",
        index: 1,
        type: "scene_card",
        display_name: "旧版分镜",
        availability: "stale",
        reason: "stale",
        snapshot: {
          title: "冻结标题",
          summary: "冻结摘要",
          content_markdown: "# 冻结正文",
          version: 3,
        },
      },
      {
        mention_id: "103",
        index: 2,
        type: "asset",
        display_name: "可用素材",
        availability: "available",
        reason: null,
        snapshot: { asset_type: "image", content_sha256: "safe-c" },
      },
    ]);
    expect(
      JSON.stringify(state.conversation_messages[0]?.mentions[0]),
    ).not.toContain("secret-a");
    expect(assetFindMany).toHaveBeenCalledWith({
      where: { id: { in: [1n, 3n] } },
      select: {
        id: true,
        user_id: true,
        project_id: true,
        status: true,
        is_delete: true,
      },
    });
  });
});
