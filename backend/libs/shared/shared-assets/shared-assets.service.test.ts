import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHARED_ASSET_TYPE_UNSUPPORTED_CODE } from "@blue-whale/contracts";
import { SharedAssetError } from "./shared-asset-error.js";
import { SharedAssetService } from "./shared-assets.service.js";
import { SharedAssetTypeRegistry } from "./type/shared-asset-type.registry.js";
import { StyleCardStrategy } from "./type/card-strategies.js";
import { SceneStrategy } from "./type/scene-strategy.js";

const { mockCreateRepo } = vi.hoisted(() => ({ mockCreateRepo: vi.fn() }));

vi.mock("@blue-whale/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blue-whale/persistence")>();
  return { ...actual, createSharedAssetRepo: mockCreateRepo };
});

const cardRow = {
  id: 1n,
  user_id: 1n,
  asset_type: "card",
  kind: "style",
  name: "赛博朋克",
  thumbnail_url: "https://x/1.png",
  snapshot: { referenceImages: [], description: "赛博朋克" },
  dedup_key: "card:style:abc",
  status: "normal",
  gmt_create: new Date("2026-08-20T00:00:00Z"),
  gmt_modified: new Date("2026-08-20T00:00:00Z"),
  version: 0,
  is_delete: 0,
};

const styleCardSave = {
  assetType: "card",
  kind: "style",
  snapshot: {
    referenceImages: [{ id: "1", src: "https://x/1.png" }],
    description: "赛博朋克",
  },
} as const;

describe("SharedAssetService", () => {
  const fakeRepo = {
    create: vi.fn(),
    findByDedupKey: vi.fn(),
    reviveByDedupKey: vi.fn(),
    listByUser: vi.fn(),
    findById: vi.fn(),
    softDeleteOwned: vi.fn(),
  };
  const source = {
    findOwnedSource: vi.fn(),
    findOwnedSceneCard: vi.fn(),
    copySceneCardToProject: vi.fn(),
  };
  const registry = new SharedAssetTypeRegistry([
    new StyleCardStrategy(),
    new SceneStrategy(source as never),
  ]);

  beforeEach(() => {
    mockCreateRepo.mockReturnValue(fakeRepo);
    vi.clearAllMocks();
  });

  const service = new SharedAssetService(
    { client: {} } as never,
    registry,
    source as never,
  );

  it("save：卡片成功 → created:true 且视图含两层类型", async () => {
    fakeRepo.create.mockResolvedValue(cardRow);
    const result = await service.save({ userId: "1" }, styleCardSave);
    expect(result.created).toBe(true);
    expect(result.item).toMatchObject({
      id: "1",
      assetType: "card",
      kind: "style",
      name: "赛博朋克",
      thumbnailUrl: "https://x/1.png",
      status: "normal",
    });
    expect(fakeRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetType: "card", kind: "style" }),
    );
  });

  it("save：撞唯一键 → created:false 返回既有项（幂等/并发兜底）", async () => {
    fakeRepo.create.mockRejectedValue({ code: "P2002" });
    fakeRepo.findByDedupKey.mockResolvedValue({ ...cardRow, id: 2n });
    const result = await service.save({ userId: "1" }, styleCardSave);
    expect(result.created).toBe(false);
    expect(result.item.id).toBe("2");
    expect(fakeRepo.findByDedupKey).toHaveBeenCalledWith(
      "1",
      expect.stringMatching(/^card:style:[0-9a-f]{64}$/),
    );
  });

  it("save：删除后重存 → 复活软删行，created:true（不再 500）", async () => {
    fakeRepo.create.mockRejectedValue({ code: "P2002" });
    fakeRepo.findByDedupKey.mockResolvedValueOnce(null); // 存活行不存在
    fakeRepo.reviveByDedupKey.mockResolvedValue({ ...cardRow, id: 6n });
    const result = await service.save({ userId: "1" }, styleCardSave);
    expect(result.created).toBe(true);
    expect(result.item.id).toBe("6");
    expect(fakeRepo.reviveByDedupKey).toHaveBeenCalledWith(
      "1",
      expect.stringMatching(/^card:style:[0-9a-f]{64}$/),
      expect.objectContaining({ name: "赛博朋克" }),
    );
  });

  it("list：asset_type/kind 双维过滤透传给仓储（缺省 = 全部）", async () => {
    fakeRepo.listByUser.mockResolvedValue({
      records: [],
      total: 0,
      size: 20,
      current: 1,
    });
    await service.list(
      { userId: "1" },
      { assetType: "card", kind: "style", page: 1, size: 20 },
    );
    expect(fakeRepo.listByUser).toHaveBeenCalledWith("1", {
      assetType: "card",
      kind: "style",
      page: 1,
      size: 20,
    });
    await service.list({ userId: "1" }, { page: 1, size: 20 });
    expect(fakeRepo.listByUser).toHaveBeenLastCalledWith("1", {
      assetType: undefined,
      kind: undefined,
      page: 1,
      size: 20,
    });
  });

  it("addSceneToProject：非场景卡类型 → 拒绝", async () => {
    fakeRepo.findById.mockResolvedValue({ ...cardRow, id: 3n });
    await expect(
      service.addSceneToProject({ userId: "1" }, "3", "9"),
    ).rejects.toMatchObject({ code: SHARED_ASSET_TYPE_UNSUPPORTED_CODE });
  });

  it("addSceneToProject：场景卡 → 复制实体到目标项目", async () => {
    fakeRepo.findById.mockResolvedValue({
      ...cardRow,
      id: 4n,
      asset_type: "scene",
      kind: null,
      name: "开场",
      snapshot: {
        title: "开场",
        summary: "summary",
        contentMarkdown: "# 开场",
        generationPreset: {
          parameters: { size: "16:9" },
          referenceMode: "first_frame",
          referenceAssets: [{ mention_id: "1" }],
          capabilitySnapshotVersion: { schema_version: 1 },
        },
      },
    });
    source.copySceneCardToProject.mockResolvedValue({
      kind: "copied",
      scene_card_id: "77",
    });
    const result = await service.addSceneToProject({ userId: "1" }, "4", "9");
    expect(result.sceneCardId).toBe("77");
    expect(source.copySceneCardToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "1",
        projectId: "9",
        title: "开场",
        content_markdown: "# 开场",
        generation_preset: expect.objectContaining({
          reference_mode: "first_frame",
        }),
      }),
    );
  });

  it("addSceneToProject：目标项目不存在 → 拒绝", async () => {
    fakeRepo.findById.mockResolvedValue({
      ...cardRow,
      id: 5n,
      asset_type: "scene",
      kind: null,
      snapshot: { title: "t", contentMarkdown: "# t", generationPreset: null },
    });
    source.copySceneCardToProject.mockResolvedValue({
      kind: "project_not_found",
    });
    await expect(
      service.addSceneToProject({ userId: "1" }, "5", "99"),
    ).rejects.toThrow(SharedAssetError);
  });
});
