/**
 * IK55VX 卡片库 mock 数据源测试(L0 纯函数 seam)。
 * 只测外部可观察行为:查询/筛选、移除、快照语义。
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  cloneCardSnapshot,
  getCardLibraryAsset,
  listCardLibrary,
  removeCardLibraryItem,
  resetCardLibrary,
  snapshotToNodeData,
} from "./cardLibrary";

beforeEach(() => resetCardLibrary());

describe("listCardLibrary", () => {
  it("不传 filter 返回库中全部卡片", () => {
    const all = listCardLibrary();
    expect(all.length).toBeGreaterThanOrEqual(5);
    // 五类卡都有 mock 数据
    for (const t of ["style", "character", "object", "environment", "custom"]) {
      expect(all.some((c) => c.cardType === t)).toBe(true);
    }
  });

  it("按 cardType 筛选只返回该类型卡片(商品卡导入复用同一入口)", () => {
    const styles = listCardLibrary({ cardType: "style" });
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.every((c) => c.cardType === "style")).toBe(true);
  });

  it('IK55VZ mock 库含商品卡示例(listCardLibrary({ cardType: "product" }) 复用)', () => {
    const products = listCardLibrary({ cardType: "product" });
    expect(products.length).toBeGreaterThanOrEqual(1);
    expect(products.every((c) => c.cardType === "product")).toBe(true);
    // 至少一张带多图 + detail + sourceUrl
    const filled = products.find(
      (c) => (c.imageAssetIds?.length ?? 0) >= 2 && c.detail && c.sourceUrl,
    );
    expect(filled).toBeDefined();
  });
});

describe("cloneCardSnapshot(导入=复制快照)", () => {
  it("带图卡快照产出新 asset id、src 与宽高比,且不等于库内 imageAssetId", () => {
    const card = listCardLibrary({ cardType: "character" }).find(
      (c) => c.imageAssetId,
    )!;
    const snap = cloneCardSnapshot(card);
    expect(snap.cardType).toBe("character");
    expect(snap.name).toBe(card.name);
    expect(snap.description).toBe(card.description);
    expect(snap.referenceAssetId).toBeDefined();
    expect(snap.referenceAssetId).not.toBe(card.imageAssetId);
    expect(snap.referenceImageAspect).toBeGreaterThan(0);
    const asset = getCardLibraryAsset(snap.referenceAssetId!);
    expect(asset?.src).toBeTruthy();
  });

  it("无图卡快照不带 referenceAssetId(落卡即空卡形态)", () => {
    const card = listCardLibrary().find((c) => !c.imageAssetId)!;
    const snap = cloneCardSnapshot(card);
    expect(snap.referenceAssetId).toBeUndefined();
  });

  it("角色卡快照带 voiceId;两次导入得到各自独立的 asset id 且数据一致", () => {
    const card = listCardLibrary({ cardType: "character" }).find(
      (c) => c.voiceId && c.imageAssetId,
    )!;
    const a = cloneCardSnapshot(card);
    const b = cloneCardSnapshot(card);
    expect(a.voiceId).toBe(card.voiceId);
    expect(a.referenceAssetId).not.toBe(b.referenceAssetId);
    expect(a.name).toBe(b.name);
    expect(a.description).toBe(b.description);
  });

  it("改快照字段不影响库内原始卡片(再次导入得到原始数据)", () => {
    const card = listCardLibrary()[0];
    const snap = cloneCardSnapshot(card);
    snap.name = "被用户改过的名字";
    snap.description = "被改过的描述";
    const again = cloneCardSnapshot(card);
    expect(again.name).toBe(card.name);
    expect(again.description).toBe(card.description);
  });

  it("IK55VZ 商品卡快照:imageAssetIds 长度一致且 id 全部重新生成、与库内原 id 不同且可解析", () => {
    const card = listCardLibrary({ cardType: "product" }).find(
      (c) => (c.imageAssetIds?.length ?? 0) >= 3,
    )!;
    const snap = cloneCardSnapshot(card);
    expect(snap.cardType).toBe("product");
    expect(snap.imageAssetIds).toHaveLength(card.imageAssetIds!.length);
    for (const [i, newId] of snap.imageAssetIds!.entries()) {
      expect(newId).not.toBe(card.imageAssetIds![i]);
      expect(card.imageAssetIds).not.toContain(newId);
      // 新 id 已登记进注册表,可解析出 src/aspect
      expect(getCardLibraryAsset(newId)?.src).toBeTruthy();
    }
  });

  it("IK55VZ 商品卡快照:detail/sourceUrl/name 透传", () => {
    const card = listCardLibrary({ cardType: "product" }).find(
      (c) => c.detail && c.sourceUrl,
    )!;
    const snap = cloneCardSnapshot(card);
    expect(snap.name).toBe(card.name);
    expect(snap.detail).toBe(card.detail);
    expect(snap.sourceUrl).toBe(card.sourceUrl);
  });

  it("IK55VZ 商品卡快照:0 图边界 → imageAssetIds 缺省或空数组,不产悬空 id", () => {
    const card = listCardLibrary({ cardType: "product" }).find(
      (c) => !c.imageAssetIds || c.imageAssetIds.length === 0,
    )!;
    const snap = cloneCardSnapshot(card);
    expect(snap.imageAssetIds ?? []).toHaveLength(0);
  });

  it("IK55VZ 商品卡快照:改快照 imageAssetIds 不影响库内项(深拷贝语义),再次导入仍重新生成", () => {
    const card = listCardLibrary({ cardType: "product" }).find(
      (c) => (c.imageAssetIds?.length ?? 0) >= 2,
    )!;
    const snap = cloneCardSnapshot(card);
    snap.imageAssetIds!.push("user-added-id");
    const again = cloneCardSnapshot(card);
    expect(again.imageAssetIds).toHaveLength(card.imageAssetIds!.length);
    expect(again.imageAssetIds).not.toContain("user-added-id");
    // 两次导入各自独立的新 id
    for (const id of again.imageAssetIds!) {
      expect(snap.imageAssetIds).not.toContain(id);
    }
    // 库内原数组未被污染
    expect(
      listCardLibrary({ cardType: "product" }).find((c) => c.id === card.id)!
        .imageAssetIds,
    ).toEqual(card.imageAssetIds);
  });
});

describe("snapshotToNodeData(快照 → 画布节点 data,runtime 导入分发共用)", () => {
  it("商品卡快照字段齐全:cardType/name/description/detail/imageAssetIds/sourceUrl", () => {
    const card = listCardLibrary({ cardType: "product" }).find(
      (c) => (c.imageAssetIds?.length ?? 0) >= 3 && c.detail && c.sourceUrl,
    )!;
    const data = snapshotToNodeData(cloneCardSnapshot(card));
    expect(data.cardType).toBe("product");
    expect(data.name).toBe(card.name);
    expect(data.description).toBe(card.description);
    expect(data.detail).toBe(card.detail);
    expect(data.sourceUrl).toBe(card.sourceUrl);
    expect(data.imageAssetIds).toHaveLength(card.imageAssetIds!.length);
    // 快照 id 已重新生成(非库内原 id)
    for (const id of data.imageAssetIds!) {
      expect(card.imageAssetIds).not.toContain(id);
    }
  });

  it("单图参考卡快照:referenceAssetId/referenceImageAspect 携带,无商品字段", () => {
    const card = listCardLibrary({ cardType: "character" }).find(
      (c) => c.imageAssetId,
    )!;
    const data = snapshotToNodeData(cloneCardSnapshot(card));
    expect(data.referenceAssetId).toBeDefined();
    expect(data.referenceImageAspect).toBeGreaterThan(0);
    expect(data.detail).toBeUndefined();
    expect(data.imageAssetIds).toBeUndefined();
    expect(data.sourceUrl).toBeUndefined();
  });

  it("无图无详情卡(自定义卡)快照:只带基础字段", () => {
    const card = listCardLibrary({ cardType: "custom" })[0];
    const data = snapshotToNodeData(cloneCardSnapshot(card));
    expect(data.cardType).toBe("custom");
    expect(data.name).toBe(card.name);
    expect(data.referenceAssetId).toBeUndefined();
    expect(data.imageAssetIds).toBeUndefined();
  });
});

describe("removeCardLibraryItem(「···」→ 移除资产)", () => {
  it("移除后该卡不再出现在列表,其余卡片不受影响", () => {
    const before = listCardLibrary();
    const victim = before[0];
    removeCardLibraryItem(victim.id);
    const after = listCardLibrary();
    expect(after.length).toBe(before.length - 1);
    expect(after.some((c) => c.id === victim.id)).toBe(false);
  });

  it("移除不存在的 id 不改变库", () => {
    const before = listCardLibrary();
    removeCardLibraryItem("no-such-id");
    expect(listCardLibrary().length).toBe(before.length);
  });
});

describe("getCardLibraryAsset 快照 id 兜底(刷新后注册表丢失场景)", () => {
  it("未注册的快照 id 按源 mock 图前缀解析(持久化重载后可重建 src)", () => {
    // 模拟页面刷新:注册表只剩 MOCK 源图,克隆时的 snap id 仍能解析
    const a = getCardLibraryAsset(
      "libimg-s1-snap-00000000-0000-4000-8000-000000000000",
    );
    expect(a).toBeDefined();
    expect(a!.src).toBeTruthy();
    expect(a!.aspect).toBeGreaterThan(0);
    expect(getCardLibraryAsset("libimg-s1-snap-bad")).toBeUndefined();
    expect(getCardLibraryAsset("not-a-library-asset")).toBeUndefined();
  });
});
