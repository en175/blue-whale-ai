import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUDIO_PROMPT_MAX_LENGTH,
  DEFAULT_PROMPT_MAX_LENGTH,
  resolvePromptMaxLength,
  type PromptLengthType,
} from "./prompt-text-limits.js";

// IKH4B8：提示词上限的**唯一**取值口径 = 模型配置优先，未配置回落缺省。
// ADR-0088 起正文由提交方给全，服务端不再组合，所以只有这一档缺省，没有「正文档 / 组合档」之分。
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

  // 读取侧 pickPositiveInt 与写入口 1–65535 已挡在前面，这里是 public 导出的自防：
  // 尤其 NaN —— `length > NaN` 恒为 false，会让闸静默失效。
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "脏值 %s 当未配置处理，回落缺省",
    (dirty) => {
      expect(resolvePromptMaxLength("image", dirty)).toBe(DEFAULT_PROMPT_MAX_LENGTH);
      expect(resolvePromptMaxLength("audio", dirty)).toBe(DEFAULT_AUDIO_PROMPT_MAX_LENGTH);
    },
  );
});
