/**
 * IK55VZ 商品卡 mock 链接导入解析测试(L0 纯函数 seam)。
 * parseProductUrl 为纯前端 mock:确定性输出、4 张内联 SVG 占位图、非法输入兜底不抛。
 */
import { describe, expect, it } from "vitest";

import {
  MAX_PRODUCT_IMAGES,
  mergeProductImageIds,
  parseProductUrl,
  PRODUCT_PLATFORMS,
  productImportHydrationAssets,
  productImportImageId,
  productImportPatch,
  shouldAdoptParsedName,
} from "./productImport";
import type { CanvasNodeData } from "./model";

describe("PRODUCT_PLATFORMS", () => {
  it("8 个平台占位项(原型空态显示),每项有 id 与短标签", () => {
    expect(PRODUCT_PLATFORMS).toHaveLength(8);
    for (const p of PRODUCT_PLATFORMS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
    }
    expect(PRODUCT_PLATFORMS.map((p) => p.label)).toEqual([
      "a",
      "抖",
      "t",
      "e",
      "s",
      "淘",
      "拼",
      "红",
    ]);
  });
});

describe("parseProductUrl(mock 链接导入解析)", () => {
  it("确定性:同一 url 多次调用输出完全一致", () => {
    const url = "https://example.com/item/42";
    expect(parseProductUrl(url)).toEqual(parseProductUrl(url));
  });

  it("images 恒为 4 张内联 SVG data-URL 占位图(不依赖网络)", () => {
    const { images } = parseProductUrl("https://example.com/item/42");
    expect(images).toHaveLength(4);
    for (const src of images) {
      expect(src.startsWith("data:image/svg+xml")).toBe(true);
    }
    // 4 张图有区分度(不同色相渐变)
    expect(new Set(images).size).toBe(4);
  });

  it("name 形如「导入商品 · <主机名>」;description 含品类/参数/卖点/人群要素", () => {
    const r = parseProductUrl("https://example.com/item/42");
    expect(r.name).toBe("导入商品 · example.com");
    expect(r.description).toContain("品类");
    expect(r.description).toContain("参数");
    expect(r.description).toContain("卖点");
    expect(r.description).toContain("人群");
  });

  it("不同 url 输出有区分度(name 或 images 不同)", () => {
    const a = parseProductUrl("https://a-shop.com/item/1");
    const b = parseProductUrl("https://b-shop.com/item/2");
    expect(a.name).not.toBe(b.name);
    const c = parseProductUrl("https://a-shop.com/item/1");
    const d = parseProductUrl("https://a-shop.com/item/2");
    expect(c.images).not.toEqual(d.images);
  });

  it("空串/非法 url 兜底:确定性输出、不抛异常", () => {
    for (const bad of ["", "   ", "not-a-url", "://"]) {
      const r = parseProductUrl(bad);
      expect(r.name).toMatch(/^导入商品 · /);
      expect(r.images).toHaveLength(4);
      expect(r.description.length).toBeGreaterThan(0);
      expect(parseProductUrl(bad)).toEqual(r);
    }
  });
});

describe("mergeProductImageIds(多图追加,≤8)", () => {
  it("MAX_PRODUCT_IMAGES 锁定 8(原型「已启用 n/8」)", () => {
    expect(MAX_PRODUCT_IMAGES).toBe(8);
  });

  it("空列表追加 → 直接采用新 id", () => {
    expect(mergeProductImageIds(undefined, ["a", "b"])).toEqual(["a", "b"]);
    expect(mergeProductImageIds([], ["a"])).toEqual(["a"]);
  });

  it("已有图追加新图,保持顺序", () => {
    expect(mergeProductImageIds(["x"], ["a", "b"])).toEqual(["x", "a", "b"]);
  });

  it("超出 8 张截断(满了不再追加)", () => {
    const six = ["1", "2", "3", "4", "5", "6"];
    expect(mergeProductImageIds(six, ["a", "b", "c", "d"])).toEqual([
      ...six,
      "a",
      "b",
    ]);
    // 已满 8 张:一张也加不进
    const eight = ["1", "2", "3", "4", "5", "6", "7", "8"];
    expect(mergeProductImageIds(eight, ["z"])).toEqual(eight);
  });
});

describe("shouldAdoptParsedName(导入名称仅覆盖自动编号/未填)", () => {
  it("未填或「商品 N」自动编号 → 采用解析名", () => {
    expect(shouldAdoptParsedName(undefined)).toBe(true);
    expect(shouldAdoptParsedName("")).toBe(true);
    expect(shouldAdoptParsedName("商品 1")).toBe(true);
    expect(shouldAdoptParsedName("商品 12")).toBe(true);
  });

  it("用户已改的名 → 不覆盖", () => {
    expect(shouldAdoptParsedName("户外蓝牙音箱")).toBe(false);
    expect(shouldAdoptParsedName("商品 1 改版")).toBe(false);
  });
});

describe("productImportPatch(链接导入填充 patch,组件与 runtime 共用)", () => {
  it("填充 imageAssetIds(合并 ≤8)/detail/sourceUrl,自动编号名被解析名替换", () => {
    const parsed = parseProductUrl("https://example.com/item/42");
    const patch = productImportPatch(
      { imageAssetIds: ["old1"], name: "商品 1" },
      parsed,
      "https://example.com/item/42",
      ["n1", "n2", "n3", "n4"],
    );
    expect(patch.imageAssetIds).toEqual(["old1", "n1", "n2", "n3", "n4"]);
    expect(patch.detail).toBe(parsed.description);
    expect(patch.sourceUrl).toBe("https://example.com/item/42");
    expect(patch.name).toBe(parsed.name);
  });

  it("用户已改名 → patch 不带 name;超 8 截断", () => {
    const parsed = parseProductUrl("https://example.com/item/42");
    const patch = productImportPatch(
      { imageAssetIds: ["1", "2", "3", "4", "5", "6", "7"], name: "运动鞋" },
      parsed,
      "https://example.com/item/42",
      ["n1", "n2", "n3", "n4"],
    );
    expect(patch.imageAssetIds).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "n1",
    ]);
    expect(patch.name).toBeUndefined();
  });
});

describe("productImportImageId(确定性 asset id,刷新后可重建)", () => {
  it("同一 url+index 恒同 id;不同 index/url 不同 id", () => {
    const url = "https://example.com/item/42";
    expect(productImportImageId(url, 0)).toBe(productImportImageId(url, 0));
    expect(productImportImageId(url, 0)).not.toBe(productImportImageId(url, 1));
    expect(productImportImageId(url, 0)).not.toBe(
      productImportImageId("https://example.com/item/43", 0),
    );
    expect(productImportImageId(url, 0)).toMatch(/^impimg-/);
  });
});

describe("productImportHydrationAssets(刷新后重注册缺失的导入图 asset)", () => {
  const url = "https://example.com/item/42";
  const productNode = (
    overrides?: Partial<CanvasNodeData>,
  ): { data: CanvasNodeData } => ({
    data: {
      kind: "reference",
      cardType: "product",
      sourceUrl: url,
      imageAssetIds: [0, 1, 2, 3].map((i) => productImportImageId(url, i)),
      ...overrides,
    },
  });

  it("assets 为空 → 按确定性 id 重注册 4 张(src 与 parseProductUrl 一致)", () => {
    const parsed = parseProductUrl(url);
    const out = productImportHydrationAssets([productNode()], {});
    expect(out).toHaveLength(4);
    for (const [i, a] of out.entries()) {
      expect(a.id).toBe(productImportImageId(url, i));
      expect(a.src).toBe(parsed.images[i]);
      expect(a.kind).toBe("image");
    }
  });

  it("已存在的 asset 不重复注册", () => {
    const existing = {
      [productImportImageId(url, 0)]: { id: "x" },
      [productImportImageId(url, 1)]: { id: "y" },
    };
    const out = productImportHydrationAssets([productNode()], existing);
    expect(out.map((a) => a.id)).toEqual([
      productImportImageId(url, 2),
      productImportImageId(url, 3),
    ]);
  });

  it("无 sourceUrl 或非 product 卡 → 不产出;imageAssetIds 外的 id 不注册", () => {
    expect(
      productImportHydrationAssets([productNode({ sourceUrl: undefined })], {}),
    ).toEqual([]);
    expect(
      productImportHydrationAssets(
        [productNode({ cardType: "character" })],
        {},
      ),
    ).toEqual([]);
    // imageAssetIds 只含前 2 张 → 只重建这 2 张
    const out = productImportHydrationAssets(
      [
        productNode({
          imageAssetIds: [
            productImportImageId(url, 0),
            productImportImageId(url, 1),
          ],
        }),
      ],
      {},
    );
    expect(out).toHaveLength(2);
  });
});
