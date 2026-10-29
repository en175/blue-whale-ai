import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharedAssetService } from "./shared-assets.service.js";
import { SharedAssetTypeRegistry } from "./type/shared-asset-type.registry.js";
import { StyleCardStrategy } from "./type/card-strategies.js";

const { mockCreateRepo } = vi.hoisted(() => ({ mockCreateRepo: vi.fn() }));

vi.mock("@lib/shared/persistence/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/persistence/index.js")>();
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
  const registry = new SharedAssetTypeRegistry([new StyleCardStrategy()]);

  beforeEach(() => {
    mockCreateRepo.mockReturnValue(fakeRepo);
    vi.clearAllMocks();
  });

  const service = new SharedAssetService({ client: {} } as never, registry);

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
    fakeRepo.findByDedupKey.mockResolvedValueOnce(null);
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

});
