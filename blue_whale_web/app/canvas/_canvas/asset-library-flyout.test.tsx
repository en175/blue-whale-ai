// @vitest-environment jsdom
/**
 * IK55VS 资产库按钮 + 悬浮列表清单配置测试。
 * seam = 配置层外部可观察形状:LEFT_TOOLS 含资产库入口;
 * ASSET_LIBRARY_FLYOUT_ITEMS 六项完整(共享资产入口 + 五类卡),与 REFERENCE_CARD_TYPES 同源。
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

  it("悬浮列表六项完整:共享资产(启用) + 五类卡", () => {
    expect(ASSET_LIBRARY_FLYOUT_ITEMS).toHaveLength(6);
    const [first, ...cards] = ASSET_LIBRARY_FLYOUT_ITEMS;
    expect(first.id).toBe("import");
    expect(first.label).toBe("共享资产");
    expect(first.disabled).toBeFalsy();
    expect(cards.map((c) => c.id)).toEqual(
      REFERENCE_CARD_TYPES.map((t) => t.id),
    );
    expect(cards.map((c) => c.label)).toEqual(
      REFERENCE_CARD_TYPES.map((t) => t.flyoutLabel),
    );
    for (const c of cards) expect(c.disabled).toBeFalsy();
  });
});
