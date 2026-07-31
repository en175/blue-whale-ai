/**
 * IK55VZ 商品卡 constants 测试：product meta（卡头名/悬浮列表双文案/占位文案）
 * 与 referenceCardHeight 高度梯度（product 高于单图参考卡，容纳图片区+链接导入区）。
 */
import { describe, expect, it } from "vitest";

import {
  REFERENCE_CARD_HEIGHT,
  REFERENCE_CARD_TYPES,
  REFERENCE_PRODUCT_HEIGHT,
  REFERENCE_VOICE_SECTION_HEIGHT,
  referenceCardHeight,
} from "./constants";

describe("IK55VZ product 参考卡 meta", () => {
  const meta = REFERENCE_CARD_TYPES.find((t) => t.id === "product");

  it("REFERENCE_CARD_TYPES 含 product（沿用统一参考卡模型，不加新节点 kind）", () => {
    expect(meta).toBeDefined();
  });

  it("product meta 文案：卡头「商品」+ 悬浮列表「新建商品」/「导入商品」+ 详情占位", () => {
    expect(meta?.label).toBe("商品");
    expect(meta?.flyoutLabel).toBe("新建商品");
    expect(meta?.flyoutImportLabel).toBe("导入商品");
    expect(meta?.placeholder).toBe("商品名称、品类、核心参数、卖点、目标人群…");
  });

  it("既有五类卡无 flyoutImportLabel（仅 product 有导入入口）", () => {
    for (const t of REFERENCE_CARD_TYPES) {
      if (t.id !== "product") expect(t.flyoutImportLabel).toBeUndefined();
    }
  });
});

describe("referenceCardHeight 高度梯度", () => {
  it("product 高度锁定（高于单图参考卡：图片区约 150px + 链接导入区）", () => {
    expect(REFERENCE_PRODUCT_HEIGHT).toBe(560);
    expect(referenceCardHeight("product")).toBe(560);
    expect(referenceCardHeight("product")).toBeGreaterThan(
      referenceCardHeight("character"),
    );
  });

  it("既有卡类高度不变（character 含音色区，其余基础高）", () => {
    expect(referenceCardHeight("style")).toBe(REFERENCE_CARD_HEIGHT);
    expect(referenceCardHeight("character")).toBe(
      REFERENCE_CARD_HEIGHT + REFERENCE_VOICE_SECTION_HEIGHT,
    );
    expect(referenceCardHeight("custom")).toBe(REFERENCE_CARD_HEIGHT);
  });
});
