import { describe, expect, it } from "vitest";

import { isTelecomPhone } from "./carrier.js";

describe("isTelecomPhone — 按号段识别中国电信", () => {
  it("识别各已分配的电信号段", () => {
    const samples = [
      "13312345678",
      "14912345678",
      "15312345678",
      "17312345678",
      "17712345678",
      "18012345678",
      "18112345678",
      "18912345678",
      "19012345678",
      "19112345678",
      "19312345678",
      "19912345678",
    ];
    expect(samples.filter((phone) => !isTelecomPhone(phone))).toEqual([]);
  });

  it("移动与联通号段判为非电信", () => {
    expect(isTelecomPhone("13812345678")).toBe(false);
    expect(isTelecomPhone("15012345678")).toBe(false);
    expect(isTelecomPhone("18712345678")).toBe(false);
    expect(isTelecomPhone("13012345678")).toBe(false);
    expect(isTelecomPhone("15612345678")).toBe(false);
    expect(isTelecomPhone("18612345678")).toBe(false);
  });

  it("非 11 位移动号码一律判为非电信", () => {
    expect(isTelecomPhone("1331234567")).toBe(false);
    expect(isTelecomPhone("133123456789")).toBe(false);
    expect(isTelecomPhone("+8613312345678")).toBe(false);
    expect(isTelecomPhone("")).toBe(false);
  });

  it("非字符串输入判为非电信", () => {
    expect(isTelecomPhone(undefined)).toBe(false);
    expect(isTelecomPhone(null)).toBe(false);
    expect(isTelecomPhone(13312345678)).toBe(false);
  });

  it("首尾空白不影响判定", () => {
    expect(isTelecomPhone("  18912345678  ")).toBe(true);
  });
});
