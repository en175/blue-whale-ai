// @vitest-environment jsdom
/**
 * IK55VS 资产库按钮 + 悬浮列表清单配置测试。
 * seam = 配置层外部可观察形状:LEFT_TOOLS 含资产库入口;
 * ASSET_LIBRARY_FLYOUT_ITEMS 六项完整(共享资产入口 + 五类参考卡);商品卡入口已迁到独立的「商品卡」按钮 PRODUCT_FLYOUT_ITEMS,资产库悬浮列表不再重复暴露。
 * IK55VX:「共享资产」项启用(打开卡片库选择器)。
 */
import { describe, expect, it } from "vitest";

import { LEFT_TOOLS, ASSET_LIBRARY_FLYOUT_ITEMS } from "./config";
import { REFERENCE_CARD_TYPES } from "./constants";

describe("IK55VS 资产库入口配置", () => {
  it("LEFT_TOOLS 含 asset-library 按钮", () => {
    const tool = LEFT_TOOLS.find((t) => t.id === "asset-library");
    expect(tool).toBeDefined();
    expect(tool?.label).toBe("资产库");
  });

  it("悬浮列表六项完整:共享资产(启用) + 五类参考卡(不含商品卡)", () => {
    expect(ASSET_LIBRARY_FLYOUT_ITEMS).toHaveLength(6);
    const [first, ...cards] = ASSET_LIBRARY_FLYOUT_ITEMS;
    expect(first.id).toBe("import");
    expect(first.label).toBe("共享资产");
    expect(first.disabled).toBeFalsy();
    const assetLibraryCardTypes = REFERENCE_CARD_TYPES.filter(
      (t) => t.id !== "product",
    );
    expect(cards.map((c) => c.id)).toEqual(
      assetLibraryCardTypes.map((t) => t.id),
    );
    expect(cards.map((c) => c.label)).toEqual(
      assetLibraryCardTypes.map((t) => t.flyoutLabel),
    );
    for (const c of cards) expect(c.disabled).toBeFalsy();
  });
});
