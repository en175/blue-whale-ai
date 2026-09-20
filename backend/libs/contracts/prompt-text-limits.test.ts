import { describe, expect, it } from "vitest";

import {
  COMPOSED_AUDIO_PROMPT_MAX_LENGTH,
  COMPOSED_IMAGE_PROMPT_MAX_LENGTH,
  COMPOSED_VIDEO_PROMPT_MAX_LENGTH,
  RAW_AUDIO_PROMPT_MAX_LENGTH,
  RAW_PROMPT_MAX_LENGTH,
  resolvePromptMaxLength,
  type PromptLengthBudget,
  type PromptLengthType,
} from "./prompt-text-limits.js";

// IKH4B8：提示词上限的唯一取值口径 = **模型配置优先，未配置才回落缺省**。
// 本文件钉住回落矩阵（两档缺省 × 三种类型）与脏值口径——它是 public 契约，
// 三道闸（raw / 组合 / 方案卡）以及之后接入的前端 IKGXO7 都依赖这张表。
describe("resolvePromptMaxLength 取值口径（IKH4B8）", () => {
  const MATRIX: Array<[PromptLengthBudget, PromptLengthType, number]> = [
    ["legacy-hardcode", "image", RAW_PROMPT_MAX_LENGTH],
    ["legacy-hardcode", "video", RAW_PROMPT_MAX_LENGTH],
    ["legacy-hardcode", "audio", RAW_AUDIO_PROMPT_MAX_LENGTH],
    ["contract-budget", "image", COMPOSED_IMAGE_PROMPT_MAX_LENGTH],
    ["contract-budget", "video", COMPOSED_VIDEO_PROMPT_MAX_LENGTH],
    ["contract-budget", "audio", COMPOSED_AUDIO_PROMPT_MAX_LENGTH],
  ];

  it.each(MATRIX)("未配置（null / undefined）：%s × %s → %i", (budget, type, expected) => {
    expect(resolvePromptMaxLength(budget, type, null)).toBe(expected);
    expect(resolvePromptMaxLength(budget, type, undefined)).toBe(expected);
  });

  it("配置了就一律用配置值——小于缺省也生效（本单要修的就是这条）", () => {
    expect(resolvePromptMaxLength("contract-budget", "video", 2_000)).toBe(2_000);
    expect(resolvePromptMaxLength("legacy-hardcode", "video", 2_000)).toBe(2_000);
    expect(resolvePromptMaxLength("contract-budget", "audio", 2_000)).toBe(2_000);
  });

  it("配置大于缺省同样生效（ADR-0085 原本要保的行为）", () => {
    expect(resolvePromptMaxLength("contract-budget", "image", 32_000)).toBe(32_000);
    expect(resolvePromptMaxLength("legacy-hardcode", "image", 32_000)).toBe(32_000);
  });

  it("配置 1 是合法值（写入口下限），不回落", () => {
    expect(resolvePromptMaxLength("contract-budget", "image", 1)).toBe(1);
  });

  // 读取侧 pickPositiveInt 与写入口 1–65535 已挡在前面，这里是 public 导出的自防：
  // 尤其 NaN —— `length > NaN` 恒为 false，会让闸静默失效。
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "脏值 %s 当未配置处理，回落缺省",
    (dirty) => {
      expect(resolvePromptMaxLength("contract-budget", "image", dirty)).toBe(
        COMPOSED_IMAGE_PROMPT_MAX_LENGTH,
      );
      expect(resolvePromptMaxLength("legacy-hardcode", "image", dirty)).toBe(RAW_PROMPT_MAX_LENGTH);
    },
  );
});
