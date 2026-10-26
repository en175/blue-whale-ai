import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSnapshotRepo } from "./snapshot-repo.js";
import { capabilityDigest } from "./capability-digest.js";

describe("SnapshotRepo.loadJobsAndAssets", () => {
  it("快照投影剥掉 input 里的 provider_credential", async () => {
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
    const MD5_200 = "d41d8cd98f00b204e9800998ecf8427e";
    const findAssets = vi.fn().mockResolvedValue([
      {
        id: 200n,
        project_id: 55n,
        type: "image",
        url: "tos://project/55/200.png",
        md5: MD5_200,
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
        OR: [{ id: { in: [200n] } }, { project_id: 55n }],
      },
    });
    expect(result.assets).toEqual([
      {
        id: "200",
        project_id: "55",
        type: "image",
        url: "tos://project/55/200.png",
        material_id: null,
        material_status: null,
        material_status_checked_at: null,
        md5: MD5_200,
      },
      {
        id: "201",
        project_id: "55",
        type: "image",
        url: "tos://project/55/201.png",
        material_id: null,
        material_status: null,
        material_status_checked_at: null,
        md5: null,
      },
    ]);
  });

  it("已关联素材库的 asset 带上本地镜像的校验状态（单次批量查，不打上游）", async () => {
    const checkedAt = new Date("2026-09-15T18:00:00+08:00");
    const findMaterialAssets = vi.fn().mockResolvedValue([
      { material_id: "asset-a", status: "Active", status_checked_at: checkedAt },
      { material_id: "asset-b", status: "Failed", status_checked_at: null },
    ]);
    const prisma = {
      generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
      assets: {
        findMany: vi.fn().mockResolvedValue([
          { id: 200n, project_id: 55n, type: "image", url: "u-200", material_id: "asset-a" },
          { id: 201n, project_id: 55n, type: "image", url: "u-201", material_id: "asset-b" },
          { id: 202n, project_id: 55n, type: "image", url: "u-202", material_id: "asset-c" },
          { id: 203n, project_id: 55n, type: "image", url: "u-203", material_id: null },
        ]),
      },
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      generation_output_slots: { findMany: vi.fn().mockResolvedValue([]) },
      material_assets: { findMany: findMaterialAssets },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets("55", "100");

    expect(findMaterialAssets).toHaveBeenCalledTimes(1);
    expect(findMaterialAssets).toHaveBeenCalledWith({
      where: {
        user_id: 100n,
        material_id: { in: ["asset-a", "asset-b", "asset-c"] },
      },
      select: { material_id: true, status: true, status_checked_at: true },
    });

    const byId = new Map(result.assets.map((a) => [a.id, a]));
    expect(byId.get("200")).toMatchObject({
      material_status: "Active",
      material_status_checked_at: "2026-09-15T18:00:00+08:00",
    });
    expect(byId.get("201")).toMatchObject({
      material_status: "Failed",
      material_status_checked_at: null,
    });
    expect(byId.get("202")).toMatchObject({
      material_status: null,
      material_status_checked_at: null,
    });
    expect(byId.get("203")).toMatchObject({
      material_status: null,
      material_status_checked_at: null,
    });
  });

  it("没有任何 asset 关联素材库时不发 material_assets 查询", async () => {
    const findMaterialAssets = vi.fn();
    const prisma = {
      generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
      assets: {
        findMany: vi.fn().mockResolvedValue([
          { id: 200n, project_id: 55n, type: "image", url: "u", material_id: null },
        ]),
      },
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      generation_output_slots: { findMany: vi.fn().mockResolvedValue([]) },
      material_assets: { findMany: findMaterialAssets },
    } as unknown as PrismaClient;

    await createSnapshotRepo(prisma).loadJobsAndAssets("55", "100");

    expect(findMaterialAssets).not.toHaveBeenCalled();
  });

  it("保留被本项目关联的跨项目素材，丢弃未关联的跨项目素材（IKCNLP bug 回归）", async () => {
    const findJobs = vi.fn().mockResolvedValue([]);
    const findAssets = vi.fn().mockResolvedValue([
      { id: 999n, project_id: 777n, type: "image", url: "tos://project/777/999.png" },
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
    const ids = result.assets.map((a) => a.id);
    expect(ids).toContain("999");
    expect(ids).not.toContain("888");
  });

  it("同一素材同时命中关联+project_id 分支时只在 assets 出现一次（IKCNLP 去重）", async () => {
    const findJobs = vi.fn().mockResolvedValue([]);
    const findAssets = vi.fn().mockResolvedValue([
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

  it("不再返回全局素材 project_id=0（全局素材移除回归）", async () => {
    const findJobs = vi.fn().mockResolvedValue([]);
    const findAssets = vi.fn().mockResolvedValue([
      { id: 600n, project_id: 0n, type: "image", url: "tos://global/600.png" },
      { id: 601n, project_id: 55n, type: "image", url: "tos://project/55/601.png" },
    ]);
    const prisma = {
      generation_jobs: { findMany: findJobs },
      assets: { findMany: findAssets },
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      generation_output_slots: { findMany: vi.fn().mockResolvedValue([]) },
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
        OR: [{ id: { in: [] } }, { project_id: 55n }],
      },
    });
    const ids = result.assets.map((a) => a.id);
    expect(ids).not.toContain("600");
    expect(ids).toContain("601");
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
      project_events: {
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _max: { cursor: 12n } }),
      },
      scene_cards: {
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
      scene_cards: [],
      scene_card_generation_records: [],
      storyboard_previews: [],
      high_watermark_cursor: "12",
    });
  });

  it("mention 表已删 → message.mentions 恒为空且素材批量查询不触发", async () => {
    const assetsFindMany = vi.fn().mockResolvedValue([]);
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
      assets: { findMany: assetsFindMany },
      scene_cards: { findMany: vi.fn().mockResolvedValue([]) },
      project_events: {
        aggregate: vi.fn().mockResolvedValue({ _max: { cursor: 12n } }),
      },
      scene_card_generation_records: { findMany: vi.fn().mockResolvedValue([]) },
      storyboard_previews: { findMany: vi.fn().mockResolvedValue([]) },
      generation_output_slots: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const state = await createSnapshotRepo(prisma).loadConversationState(
      "42",
      "100",
    );

    expect(state.conversation_messages[0]?.mentions).toEqual([]);
    expect(assetsFindMany).not.toHaveBeenCalled();
  });
});

describe("SnapshotRepo.loadConversationState output slots", () => {
  it("collapses retry attempts into stable logical slots", async () => {
    const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });
    const prisma = {
      conversation_messages: empty(),
      project_events: {
        aggregate: vi.fn().mockResolvedValue({ _max: { cursor: null } }),
      },
      scene_cards: empty(),
      scene_card_generation_records: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 88n,
            scene_card_id: 66n,
            summary_status: "partial",
            first_generation_job_id: 300n,
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
