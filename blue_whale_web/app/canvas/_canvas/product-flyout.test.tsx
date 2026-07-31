// @vitest-environment jsdom
/**
 * IK55VZ 商品卡工具栏入口配置测试。
 * seam = 配置层外部可观察形状:LEFT_TOOLS 第 8 按钮「商品卡」;
 * PRODUCT_FLYOUT_ITEMS 两项「新建商品」/「导入商品」,文案与
 * constants.REFERENCE_CARD_TYPES product meta 同源(flyoutLabel/flyoutImportLabel)。
 */
import { describe, expect, it } from "vitest";

import { LEFT_TOOLS, PRODUCT_FLYOUT_ITEMS } from "./config";
import { REFERENCE_CARD_TYPES } from "./constants";

describe("IK55VZ 商品卡工具栏入口", () => {
  it("LEFT_TOOLS 第 8 按钮:id=product-card、label=商品卡", () => {
    expect(LEFT_TOOLS).toHaveLength(8);
    const tool = LEFT_TOOLS[7];
    expect(tool.id).toBe("product-card");
    expect(tool.label).toBe("商品卡");
    expect(tool.icon).toBeTruthy();
  });

  it("悬浮列表两项:新建商品/导入商品,文案与 product meta 同源", () => {
    const meta = REFERENCE_CARD_TYPES.find((t) => t.id === "product")!;
    expect(PRODUCT_FLYOUT_ITEMS).toHaveLength(2);
    expect(PRODUCT_FLYOUT_ITEMS[0].id).toBe("new");
    expect(PRODUCT_FLYOUT_ITEMS[0].label).toBe(meta.flyoutLabel);
    expect(PRODUCT_FLYOUT_ITEMS[1].id).toBe("import");
    expect(PRODUCT_FLYOUT_ITEMS[1].label).toBe(meta.flyoutImportLabel);
    for (const item of PRODUCT_FLYOUT_ITEMS) {
      expect(item.disabled).toBeFalsy();
      expect(item.icon).toBeTruthy();
    }
  });
});
