// IKBQEE / ADR-0078 二期：对外数值错误码映射（前端按 code 映射文案的唯一来源）。
import { describe, expect, it } from "vitest";

import {
  ERROR_QUOTA_EXHAUSTED,
  ERROR_INVALID_INPUT,
  ERROR_PROVIDER_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
  GENERATION_ERROR_UNKNOWN_NUMERIC_CODE,
  errorCodeToNumeric,
} from "./generation-error-codes.js";

describe("generation error numeric codes (external contract)", () => {
  it("关键映射稳定（前端契约）", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_QUOTA_EXHAUSTED]).toBe(1001);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_INVALID_INPUT]).toBe(1002);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_PROVIDER_FAILED]).toBe(1011);
    expect(errorCodeToNumeric(ERROR_QUOTA_EXHAUSTED)).toBe(1001);
  });

  it("数值码在 1xxx 段（与 100xxx SystemCode 段区分）", () => {
    for (const n of Object.values(GENERATION_ERROR_NUMERIC_CODES)) {
      expect(n).toBeGreaterThanOrEqual(1000);
      expect(n).toBeLessThan(2000);
    }
  });

  it("未知码兜底 1000", () => {
    expect(errorCodeToNumeric("some_unknown_code")).toBe(
      GENERATION_ERROR_UNKNOWN_NUMERIC_CODE,
    );
    expect(GENERATION_ERROR_UNKNOWN_NUMERIC_CODE).toBe(1000);
  });
});
