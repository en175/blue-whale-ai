import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUDIO_PROMPT_MAX_LENGTH,
  DEFAULT_PROMPT_MAX_LENGTH,
  resolvePromptMaxLength,
  type PromptLengthType,
} from "./prompt-text-limits.js";

describe("resolvePromptMaxLength 取值口径（IKH4B8）", () => {
  const MATRIX: Array<[PromptLengthType, number]> = [
    ["image", DEFAULT_PROMPT_MAX_LENGTH],
    ["video", DEFAULT_PROMPT_MAX_LENGTH],
    ["audio", DEFAULT_AUDIO_PROMPT_MAX_LENGTH],
  ];

  it.each(MATRIX)("未配置（null / undefined）：%s → %i", (type, expected) => {
    expect(resolvePromptMaxLength(type, null)).toBe(expected);
    expect(resolvePromptMaxLength(type, undefined)).toBe(expected);
  });

  it("配置了就一律用配置值——小于缺省也生效（本单要修的就是这条）", () => {
    expect(resolvePromptMaxLength("image", 2_000)).toBe(2_000);
    expect(resolvePromptMaxLength("video", 2_000)).toBe(2_000);
    expect(resolvePromptMaxLength("audio", 2_000)).toBe(2_000);
  });

  it("配置大于缺省同样生效（ADR-0085 原本要保的行为）", () => {
    expect(resolvePromptMaxLength("image", 32_000)).toBe(32_000);
  });

  it("配置 1 是合法值（写入口下限），不回落", () => {
    expect(resolvePromptMaxLength("image", 1)).toBe(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "脏值 %s 当未配置处理，回落缺省",
    (dirty) => {
      expect(resolvePromptMaxLength("image", dirty)).toBe(DEFAULT_PROMPT_MAX_LENGTH);
      expect(resolvePromptMaxLength("audio", dirty)).toBe(DEFAULT_AUDIO_PROMPT_MAX_LENGTH);
    },
  );
});
