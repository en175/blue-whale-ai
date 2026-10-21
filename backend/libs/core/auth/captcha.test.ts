import { describe, expect, it } from "vitest";

import { CAPTCHA_TOLERANCE_PX, isCaptchaAligned } from "./captcha.js";

describe("isCaptchaAligned", () => {
  it("误差在 5px 内算对", () => {
    expect(isCaptchaAligned(100, 100)).toBe(true);
    expect(isCaptchaAligned(105, 100)).toBe(true);
    expect(isCaptchaAligned(95, 100)).toBe(true);
  });

  it("超过容差判失败", () => {
    expect(isCaptchaAligned(100 + CAPTCHA_TOLERANCE_PX + 1, 100)).toBe(false);
    expect(isCaptchaAligned(100 - CAPTCHA_TOLERANCE_PX - 1, 100)).toBe(false);
  });

  it("非数字/NaN 一律失败", () => {
    expect(isCaptchaAligned("100", 100)).toBe(false);
    expect(isCaptchaAligned(Number.NaN, 100)).toBe(false);
    expect(isCaptchaAligned(undefined, 100)).toBe(false);
  });
});
