import { describe, expect, it } from "vitest";
import {
  addSharedAssetToProjectRequestSchema,
  saveSharedAssetRequestSchema,
  sharedAssetListQuerySchema,
} from "./shared-asset.js";

describe("saveSharedAssetRequestSchema（assetType + kind 两层判别联合）", () => {
  it("卡片：assetType=card + kind + 快照", () => {
    const req = saveSharedAssetRequestSchema.parse({
      assetType: "card",
      kind: "style",
      snapshot: {
        referenceImages: [{ id: "1", src: "https://x/1.png" }],
        description: "赛博朋克",
      },
    });
    expect(req.assetType).toBe("card");
    expect(req.kind).toBe("style");
  });

  it("商品/文本：快照直传，无 kind", () => {
    const goods = saveSharedAssetRequestSchema.parse({
      assetType: "goods",
      snapshot: {
        name: "杯子",
        images: [{ id: "1", src: "https://x/1.png", enabled: true }],
      },
    });
    expect(goods.assetType).toBe("goods");
    const text = saveSharedAssetRequestSchema.parse({
      assetType: "text",
      snapshot: { html: "<p>文案</p>" },
    });
    expect(text.snapshot.html).toBe("<p>文案</p>");
  });

  it("媒体：assetType=media + kind + sourceAssetId，name 可选", () => {
    const req = saveSharedAssetRequestSchema.parse({
      assetType: "media",
      kind: "image",
      sourceAssetId: "42",
      name: "图.png",
    });
    expect(req.kind).toBe("image");
    expect(req.sourceAssetId).toBe("42");
    expect(() =>
      saveSharedAssetRequestSchema.parse({ assetType: "media", kind: "video" }),
    ).toThrow();
  });

  it("场景卡：assetType=scene + sourceSceneCardId", () => {
    const req = saveSharedAssetRequestSchema.parse({
      assetType: "scene",
      sourceSceneCardId: "7",
    });
    expect(req.sourceSceneCardId).toBe("7");
    expect(() =>
      saveSharedAssetRequestSchema.parse({ assetType: "scene" }),
    ).toThrow();
  });

  it("非法类型/kind 与形状不匹配 → 拒绝", () => {
    expect(() =>
      saveSharedAssetRequestSchema.parse({ assetType: "nope" }),
    ).toThrow();
    expect(() =>
      saveSharedAssetRequestSchema.parse({
        assetType: "card",
        snapshot: { referenceImages: [] },
      }),
    ).toThrow();
    expect(() =>
      saveSharedAssetRequestSchema.parse({
        assetType: "card",
        kind: "image",
        snapshot: { referenceImages: [] },
      }),
    ).toThrow();
  });
});

describe("sharedAssetListQuerySchema（assetType/kind 双维过滤，缺省=全部）", () => {
  it("双维过滤", () => {
    const q = sharedAssetListQuerySchema.parse({
      assetType: "card",
      kind: "style",
      page: "2",
      size: "10",
    });
    expect(q.assetType).toBe("card");
    expect(q.kind).toBe("style");
    expect(q.page).toBe(2);
    expect(q.size).toBe(10);
  });

  it("缺省 → 全部；缺省分页 → 1/20", () => {
    const q = sharedAssetListQuerySchema.parse({});
    expect(q.assetType).toBeUndefined();
    expect(q.kind).toBeUndefined();
    expect(q.page).toBe(1);
    expect(q.size).toBe(20);
  });

  it("非法值 → 拒绝", () => {
    expect(() =>
      sharedAssetListQuerySchema.parse({ kind: "foo" }),
    ).toThrow();
  });
});

describe("addSharedAssetToProjectRequestSchema", () => {
  it("合法 projectId 通过", () => {
    expect(
      addSharedAssetToProjectRequestSchema.parse({ projectId: "9" }).projectId,
    ).toBe("9");
    expect(() =>
      addSharedAssetToProjectRequestSchema.parse({ projectId: "abc" }),
    ).toThrow();
  });
});
