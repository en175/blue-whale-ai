import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSnapshotRepo } from "./snapshot-repo.js";
import { capabilityDigest } from "./capability-digest.js";

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
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([]),
      },
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
      project_asset: { findMany: vi.fn().mockResolvedValue([{ asset_id: 200n }]) },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets(
      "55",
      "100",
    );

    expect(findAssets).toHaveBeenCalledTimes(1);
    expect(findAssets).toHaveBeenCalledWith({
      where: {
        user_id: 100n,
        status: "normal",
        is_delete: false,
        OR: [
          { id: { in: [200n] } },
          { project_id: 0n },
          { project_id: 55n },
        ],
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

  it("保留被本项目关联的跨项目素材，丢弃未关联的跨项目素材（IKCNLP bug 回归）", async () => {
    const findJobs = vi.fn().mockResolvedValue([]);
    const findAssets = vi.fn().mockResolvedValue([
      // 跨项目关联命中的素材（project_id=777 是别项目，但已被本项目 project_asset 关联）→ 应保留
      { id: 999n, project_id: 777n, type: "image", url: "tos://project/777/999.png" },
      // 未关联的跨项目素材（project_id=777，不在 linkedSet）→ 应丢弃
      { id: 888n, project_id: 777n, type: "image", url: "tos://project/777/888.png" },
    ]);
    const prisma = {
      generation_jobs: { findMany: findJobs },
      assets: { findMany: findAssets },
      project_asset: { findMany: vi.fn().mockResolvedValue([{ asset_id: 999n }]) },
      generation_output_slots: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets(
      "55",
      "100",
    );
    // 999 关联命中 → 保留；888 未关联且 project_id=777 !== 55 且 !== 0 → 丢弃
    const ids = result.assets.map((a) => a.id);
    expect(ids).toContain("999");
    expect(ids).not.toContain("888");
  });

  it("同一素材同时命中关联+project_id 分支时只在 assets 出现一次（IKCNLP 去重）", async () => {
    const findJobs = vi.fn().mockResolvedValue([]);
    const findAssets = vi.fn().mockResolvedValue([
      // 既是本项目 project_id=55，又被 project_asset 关联 → 两条 OR 分支都命中
      { id: 300n, project_id: 55n, type: "image", url: "tos://project/55/300.png" },
    ]);
    const prisma = {
      generation_jobs: { findMany: findJobs },
      assets: { findMany: findAssets },
      project_asset: { findMany: vi.fn().mockResolvedValue([{ asset_id: 300n }]) },
      generation_output_slots: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets(
      "55",
      "100",
    );
    const matching = result.assets.filter((a) => a.id === "300");
    expect(matching).toHaveLength(1);
  });
});

describe("SnapshotRepo.loadConversationState", () => {
  it("returns persisted messages and the real high-watermark", async () => {
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
      generation_model_capability: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      plan_application_receipts: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      scene_card_generation_records: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      storyboard_previews: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      assets: { findMany: vi.fn().mockResolvedValue([]) },
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
      scene_card_generation_records: [],
      storyboard_previews: [],
      high_watermark_cursor: "12",
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
      project_events: {
        aggregate: vi.fn().mockResolvedValue({ _max: { cursor: 12n } }),
      },
      plan_messages: { findMany: vi.fn().mockResolvedValue([]) },
      generation_model_capability: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      plan_application_receipts: { findMany: vi.fn().mockResolvedValue([]) },
      scene_card_generation_records: { findMany: vi.fn().mockResolvedValue([]) },
      storyboard_previews: { findMany: vi.fn().mockResolvedValue([]) },
      generation_output_slots: { findMany: vi.fn().mockResolvedValue([]) },
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

  // —— plan_messages.application_availability 投影（IK6MZU）：复用 loadPlanApplicationFacts，
  //    读路径 missingMention="unavailable"，不查余额（恒 available/requires_new_plan）。——
  describe("plan_messages.application_availability 投影（IK6MZU）", () => {
    const CAP_FIELDS = {
      supported_sizes: ["1024x1024"],
      supported_aspect_ratios: ["1:1"],
      supported_durations: null,
      supported_formats: ["png"],
      default_size: "1024x1024",
      default_format: "png",
      default_aspect_ratio: "1:1",
      default_duration: null,
    };
    const SNAPSHOT = {
      schema_version: 1,
      capability_type: "image",
      model_id: "doubao-seedream-5.0-lite",
      provider_id: "doubao",
      row_version: 3,
      digest: capabilityDigest(CAP_FIELDS),
    };

    function buildPlanMessage(derivedReferences: unknown[]) {
      return {
        message_id: 500n,
        conversation_id: 50n,
        agent_run_id: 9n,
        project_id: 42n,
        ordinal: 1,
        total_in_batch: 1,
        sequence_label: null,
        application_kind: "image_generate",
        target_scene_card_mention_id: null,
        base_scene_card_version: null,
        content_markdown: "一只蓝鲸",
        derived_references: derivedReferences,
        frozen_generation_parameters: {},
        capability_snapshot_version: SNAPSHOT,
        provider_prompt_projection: {},
        base_plan_message_id: null,
        source_plan_message_id: null,
        applied_at: null,
        first_generation_job_id: null,
        gmt_create: new Date("2026-08-05T00:00:00.000Z"),
      };
    }

    function matchingCapability(overrides: Record<string, unknown> = {}) {
      return {
        model_id: "doubao-seedream-5.0-lite",
        capability_type: "image",
        version: 3,
        enabled: true,
        is_delete: false,
        ...CAP_FIELDS,
        ...overrides,
      };
    }

    function assetRow(id: bigint, overrides: Record<string, unknown> = {}) {
      return {
        id,
        user_id: 100n,
        project_id: 42n,
        status: "normal",
        is_delete: false,
        ...overrides,
      };
    }

    function mentionRow(id: bigint, targetId: bigint) {
      return {
        id,
        message_id: 8n,
        accepted_user_id: 100n,
        mention_seq: 0,
        mention_type: "asset",
        target_id: targetId,
        target_version: null,
        display_name: "素材",
        snapshot: {},
      };
    }

    function buildPrisma(opts: {
      planMessages: unknown[];
      capabilityRows?: unknown[];
      mentions?: unknown[];
      assets?: unknown[];
    }) {
      return {
        conversation_messages: { findMany: vi.fn().mockResolvedValue([]) },
        conversation_message_mentions: {
          findMany: vi.fn().mockResolvedValue(opts.mentions ?? []),
        },
        plan_messages: {
          findMany: vi.fn().mockResolvedValue(opts.planMessages),
        },
        generation_model_capability: {
          findMany: vi.fn().mockResolvedValue(
            opts.capabilityRows ?? [matchingCapability()],
          ),
        },
        project_events: {
          aggregate: vi.fn().mockResolvedValue({ _max: { cursor: 0n } }),
        },
        scene_cards: { findMany: vi.fn().mockResolvedValue([]) },
        plan_application_receipts: { findMany: vi.fn().mockResolvedValue([]) },
        scene_card_generation_records: { findMany: vi.fn().mockResolvedValue([]) },
        storyboard_previews: { findMany: vi.fn().mockResolvedValue([]) },
        generation_output_slots: { findMany: vi.fn().mockResolvedValue([]) },
        assets: { findMany: vi.fn().mockResolvedValue(opts.assets ?? []) },
      } as unknown as PrismaClient;
    }

    async function firstAvailability(prisma: PrismaClient) {
      const state = await createSnapshotRepo(prisma).loadConversationState(
        "42",
        "100",
      );
      return state.plan_messages[0]?.application_availability ?? "MISSING";
    }

    it("asset 状态 normal + 能力 version/digest 匹配 → available", async () => {
      const prisma = buildPrisma({
        planMessages: [buildPlanMessage([{ mention_id: "101", type: "asset" }])],
        mentions: [mentionRow(101n, 1n)],
        assets: [assetRow(1n)],
      });
      expect(await firstAvailability(prisma)).toBe("available");
    });

    it("derived mention_id 在 mentionRows 缺失 → requires_new_plan（读路径 unavailable 语义）", async () => {
      const prisma = buildPrisma({
        planMessages: [buildPlanMessage([{ mention_id: "404", type: "asset" }])],
        mentions: [], // 404 行缺失 → helper 判失效
      });
      expect(await firstAvailability(prisma)).toBe("requires_new_plan");
    });

    it("asset 已删（is_delete）→ requires_new_plan", async () => {
      const prisma = buildPrisma({
        planMessages: [buildPlanMessage([{ mention_id: "101", type: "asset" }])],
        mentions: [mentionRow(101n, 1n)],
        assets: [assetRow(1n, { is_delete: true })],
      });
      expect(await firstAvailability(prisma)).toBe("requires_new_plan");
    });

    it("能力行缺失 → requires_new_plan", async () => {
      const prisma = buildPrisma({
        planMessages: [buildPlanMessage([{ mention_id: "101", type: "asset" }])],
        capabilityRows: [],
        mentions: [mentionRow(101n, 1n)],
        assets: [assetRow(1n)],
      });
      expect(await firstAvailability(prisma)).toBe("requires_new_plan");
    });

    it("能力 row_version 变 → requires_new_plan", async () => {
      const prisma = buildPrisma({
        planMessages: [buildPlanMessage([{ mention_id: "101", type: "asset" }])],
        capabilityRows: [matchingCapability({ version: 99 })],
        mentions: [mentionRow(101n, 1n)],
        assets: [assetRow(1n)],
      });
      expect(await firstAvailability(prisma)).toBe("requires_new_plan");
    });

    it("能力被禁用（enabled=false）→ requires_new_plan", async () => {
      const prisma = buildPrisma({
        planMessages: [buildPlanMessage([{ mention_id: "101", type: "asset" }])],
        capabilityRows: [matchingCapability({ enabled: false })],
        mentions: [mentionRow(101n, 1n)],
        assets: [assetRow(1n)],
      });
      expect(await firstAvailability(prisma)).toBe("requires_new_plan");
    });

    it("scene_card 引用跳过（不参与判定）→ available", async () => {
      const prisma = buildPrisma({
        planMessages: [buildPlanMessage([{ mention_id: "555", type: "scene_card" }])],
        // 555 mention 不存在也无所谓——scene_card 引用被 helper 跳过
      });
      expect(await firstAvailability(prisma)).toBe("available");
    });

    it("读路径不查余额：投影恒为 available | requires_new_plan", async () => {
      const prisma = buildPrisma({
        planMessages: [buildPlanMessage([])],
      });
      const availability = await firstAvailability(prisma);
      expect(["available", "requires_new_plan"]).toContain(availability);
    });
  });
});

describe("SnapshotRepo.loadConversationState output slots", () => {
  it("collapses retry attempts into stable logical slots", async () => {
    const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });
    const prisma = {
      conversation_messages: empty(),
      conversation_message_mentions: empty(),
      plan_messages: empty(),
      generation_model_capability: empty(),
      project_events: {
        aggregate: vi.fn().mockResolvedValue({ _max: { cursor: null } }),
      },
      scene_cards: empty(),
      plan_application_receipts: empty(),
      scene_card_generation_records: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 88n,
            scene_card_id: 66n,
            summary_status: "partial",
            first_generation_job_id: 300n,
            plan_message_id: 44n,
          },
        ]),
      },
      storyboard_previews: empty(),
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 401n,
            scene_card_generation_record_id: 88n,
            slot_index: 0,
            status: "failed",
            asset_id: null,
            retry_of_slot_id: null,
            initial_placement_status: "pending",
          },
          {
            id: 501n,
            scene_card_generation_record_id: 88n,
            slot_index: 0,
            status: "succeeded",
            asset_id: 901n,
            retry_of_slot_id: 401n,
            initial_placement_status: "pending",
          },
          {
            id: 402n,
            scene_card_generation_record_id: 88n,
            slot_index: 1,
            status: "failed",
            asset_id: null,
            retry_of_slot_id: null,
            initial_placement_status: "pending",
          },
        ]),
      },
    } as unknown as PrismaClient;

    const snapshot = await createSnapshotRepo(prisma).loadConversationState(
      "55",
      "9",
    );

    expect(
      snapshot.scene_card_generation_records[0]?.output_slots,
    ).toEqual([
      {
        slot_id: "501",
        slot_index: 0,
        status: "succeeded",
        asset_id: "901",
        retry_of_slot_id: "401",
        initial_placement_status: "pending",
      },
      {
        slot_id: "402",
        slot_index: 1,
        status: "failed",
        asset_id: null,
        retry_of_slot_id: null,
        initial_placement_status: "pending",
      },
    ]);
  });
});
