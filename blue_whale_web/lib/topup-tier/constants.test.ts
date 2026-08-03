import { describe, expect, it } from "vitest";

import {
  deriveTierAmount,
  parseTierDiscount,
  parseTierOriginalPrice,
} from "./constants";

describe("parseTierOriginalPrice（只接受正整数 N）", () => {
  it("正整数通过（含数字字符串）", () => {
    expect(parseTierOriginalPrice(100)).toBe(100);
    expect(parseTierOriginalPrice(1)).toBe(1);
    expect(parseTierOriginalPrice("100")).toBe(100);
  });

  it("小数 / 零 / 负数 / 非数字 → null", () => {
    expect(parseTierOriginalPrice(10.5)).toBeNull();
    expect(parseTierOriginalPrice(0)).toBeNull();
    expect(parseTierOriginalPrice(-100)).toBeNull();
    expect(parseTierOriginalPrice("abc")).toBeNull();
    expect(parseTierOriginalPrice("")).toBeNull();
    expect(parseTierOriginalPrice(null)).toBeNull();
    expect(parseTierOriginalPrice(undefined)).toBeNull();
    expect(parseTierOriginalPrice(NaN)).toBeNull();
    expect(parseTierOriginalPrice([100])).toBeNull();
  });
});

describe("parseTierDiscount（(0, 1] 实付倍率）", () => {
  it("合法值通过", () => {
    expect(parseTierDiscount(0.85)).toBe(0.85);
    expect(parseTierDiscount(1)).toBe(1);
    expect(parseTierDiscount(0.01)).toBe(0.01);
  });

  it("越界 / NaN / 非数字 → null（堵比较运算符放行 NaN 的洞）", () => {
    expect(parseTierDiscount(0)).toBeNull();
    expect(parseTierDiscount(1.5)).toBeNull();
    expect(parseTierDiscount(-0.5)).toBeNull();
    expect(parseTierDiscount("abc")).toBeNull();
    expect(parseTierDiscount(NaN)).toBeNull();
    expect(parseTierDiscount(undefined)).toBeNull();
  });
});

describe("deriveTierAmount（积分 = N × QuotaPerUnit）", () => {
  it("与 Go 到账口径一致", () => {
    expect(deriveTierAmount(100)).toBe(50_000_000);
    expect(deriveTierAmount(2)).toBe(1_000_000);
    expect(deriveTierAmount(11)).toBe(5_500_000);
  });

  it("防御性取整（正常路径原价已被强制为整数）", () => {
    expect(deriveTierAmount(10.5)).toBe(5_500_000); // round(10.5)=11
  });
});
