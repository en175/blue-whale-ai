import { describe, expect, it } from "vitest";
import { QUOTA_TO_CREDITS_DIVISOR, quotaToCredits } from "./credits.js";

describe("credits 展示口径（产品确认：1 元 = 10 积分 = 1 美元 = 500,000 quota）", () => {
  it("积分 = quota / 50000（1 积分 = 50,000 quota = 0.1 美元）", () => {
    expect(QUOTA_TO_CREDITS_DIVISOR).toBe(50_000);
  });
  it("500,000 quota = 10 积分（= 1 元 = 1 美元）", () => {
    expect(quotaToCredits(500_000)).toBe(10);
  });
  it("50,000,000 quota = 1000 积分（充 100 元档位）", () => {
    expect(quotaToCredits(50_000_000)).toBe(1000);
  });
  it("非正数返回 0", () => {
    expect(quotaToCredits(0)).toBe(0);
    expect(quotaToCredits(-1)).toBe(0);
  });
});
