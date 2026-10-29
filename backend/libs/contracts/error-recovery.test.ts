import { describe, expect, it } from "vitest";
import {
  ERROR_CATEGORY_CODES,
  ERROR_CODES,
  ERROR_QUOTE_UNAVAILABLE,
  ERROR_REFERENCE_TOO_LARGE,
  GENERATION_ERROR_NUMERIC_CODES,
  errorRecoveryOf,
} from "./error-codes.js";

describe("错误分类与可恢复性", () => {
  it("覆盖全部生成错误码且不重复", () => {
    const all = Object.values(ERROR_CATEGORY_CODES).flat();
    expect(new Set(all).size).toBe(all.length);

    const declared = new Set(Object.values(GENERATION_ERROR_NUMERIC_CODES));
    const covered = new Set(all);
    const missing = [...declared].filter((code) => !covered.has(code));
    const extra = [...covered].filter((code) => !declared.has(code));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it("每个码都有文案", () => {
    for (const code of Object.values(GENERATION_ERROR_NUMERIC_CODES)) {
      expect(ERROR_CODES[code]).toBeTypeOf("string");
      expect(ERROR_CODES[code]).not.toBe("");
    }
  });

  it("只有临时异常可恢复", () => {
    for (const [category, codes] of Object.entries(ERROR_CATEGORY_CODES)) {
      for (const code of codes) {
        expect(errorRecoveryOf(code)).toEqual({
          category,
          retryable: category === "transient",
        });
      }
    }
  });

  it("未知码兜底为 unknown 且不可恢复", () => {
    expect(errorRecoveryOf(9999)).toEqual({ category: "unknown", retryable: false });
  });

  it("补充的报价不可用与参考过大均有分类和文案", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_QUOTE_UNAVAILABLE]).toBe(1063);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_REFERENCE_TOO_LARGE]).toBe(1064);
    expect(errorRecoveryOf(1063)).toEqual({ category: "quote_changed", retryable: false });
    expect(errorRecoveryOf(1064)).toEqual({ category: "reference", retryable: false });
  });
});
