import { describe, expect, it, vi } from "vitest";

import { AssetsController } from "./assets.controller.js";


function createController(overrides: {
  findOwnedById?: ReturnType<typeof vi.fn>;
  countReferencingProjects?: ReturnType<typeof vi.fn>;
  softDeleteOwned?: ReturnType<typeof vi.fn>;
  cascadeDeleteUpstreamMaterial?: ReturnType<typeof vi.fn>;
  listLibraryAssets?: ReturnType<typeof vi.fn>;
} = {}) {
  const assets = {
    findOwnedById:
      overrides.findOwnedById ?? vi.fn().mockResolvedValue({ id: "42" }),
    countReferencingProjects:
      overrides.countReferencingProjects ?? vi.fn().mockResolvedValue(3),
    softDeleteOwned:
      overrides.softDeleteOwned ?? vi.fn().mockResolvedValue(true),
  };
  const material = {
    cascadeDeleteUpstreamMaterial:
      overrides.cascadeDeleteUpstreamMaterial ??
      vi.fn().mockResolvedValue(undefined),
    listLibraryAssets:
      overrides.listLibraryAssets ??
      vi.fn().mockResolvedValue({ TotalCount: 0, Items: [] }),
  };
  const controller = new AssetsController(assets as never, material as never);
  return { controller, assets, material };
}

const USER = { userId: "9", username: "alice" } as never;

describe("AssetsController.getReferences（IKCZAT）", () => {
  it("素材存在且归属 → 返回 { assetId, projectCount }", async () => {
    const { controller, assets } = createController();
    const result = await controller.getReferences(USER, "42");
    expect(result).toMatchObject({
      code: 200,
      data: { assetId: "42", projectCount: 3 },
    });
    expect(assets.findOwnedById).toHaveBeenCalledWith("42", "9");
    expect(assets.countReferencingProjects).toHaveBeenCalledWith("42", "9");
  });

  it("素材不存在/不归属 → 100301，不调计数", async () => {
    const { controller, assets } = createController({
      findOwnedById: vi.fn().mockResolvedValue(null),
    });
    const result = await controller.getReferences(USER, "999");
    expect(result).toMatchObject({ code: 100301 });
    expect(assets.countReferencingProjects).not.toHaveBeenCalled();
  });
});

describe("AssetsController.listLibraryMaterials（ADR-0126）", () => {
  it("请求体原样交给 MaterialService，结果包成产品信封", async () => {
    const { controller, material } = createController({
      listLibraryAssets: vi.fn().mockResolvedValue({
        TotalCount: 1,
        Items: [
          { Id: "asset-a", asset_id: "526", url: "https://cdn.test/a.png" },
        ],
      }),
    });

    const result = await controller.listLibraryMaterials(USER, {
      Filter: { GroupType: "AIGC" },
      PageNumber: 1,
    });

    expect(material.listLibraryAssets).toHaveBeenCalledWith({
      userId: "9",
      body: { Filter: { GroupType: "AIGC" }, PageNumber: 1 },
    });
    expect(result).toMatchObject({ code: 200, data: { TotalCount: 1 } });
  });
});

describe("AssetsController.remove（ADR-0126 级联删上游素材）", () => {
  it("已入库 → 先删上游素材，再软删本地", async () => {
    const { controller, assets, material } = createController({
      findOwnedById: vi.fn().mockResolvedValue({ id: "42", material_id: "asset-x" }),
    });

    const result = await controller.remove(USER, "42");

    expect(material.cascadeDeleteUpstreamMaterial).toHaveBeenCalledWith({
      userId: "9",
      materialId: "asset-x",
    });
    expect(assets.softDeleteOwned).toHaveBeenCalledWith("42", "9");
    expect(result).toMatchObject({ code: 200 });
  });

  it("未入库 → 不碰上游，直接软删本地", async () => {
    const { controller, assets, material } = createController({
      findOwnedById: vi.fn().mockResolvedValue({ id: "42", material_id: null }),
    });

    await controller.remove(USER, "42");

    expect(material.cascadeDeleteUpstreamMaterial).not.toHaveBeenCalled();
    expect(assets.softDeleteOwned).toHaveBeenCalledWith("42", "9");
  });

  it("上游删不掉 → 抛错，本地一行不动（不假装删掉了）", async () => {
    const { controller, assets } = createController({
      findOwnedById: vi.fn().mockResolvedValue({ id: "42", material_id: "asset-x" }),
      cascadeDeleteUpstreamMaterial: vi.fn().mockRejectedValue(new Error("上游 500")),
    });

    await expect(controller.remove(USER, "42")).rejects.toThrow("上游 500");
    expect(assets.softDeleteOwned).not.toHaveBeenCalled();
  });

  it("素材不存在/不归属 → 100301，不碰上游也不软删", async () => {
    const { controller, assets, material } = createController({
      findOwnedById: vi.fn().mockResolvedValue(null),
    });

    const result = await controller.remove(USER, "999");

    expect(result).toMatchObject({ code: 100301 });
    expect(material.cascadeDeleteUpstreamMaterial).not.toHaveBeenCalled();
    expect(assets.softDeleteOwned).not.toHaveBeenCalled();
  });
});
