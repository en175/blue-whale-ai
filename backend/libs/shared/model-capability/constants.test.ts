import { describe, expect, it } from "vitest";

import { parseModelCreateBody, parseModelUpdateBody } from "./constants.js";

describe("parseModelCreateBody", () => {
  it("不接 provider_id，系统写死 new-api", () => {
    const parsed = parseModelCreateBody({
      model_id: "gpt-image-2",
      capability_type: "image",
      model_label: "GPT Image 2",
      icon: null,
      channel_parser: "gpt",
      request_mapping: { matrix: { "1k": { "1:1": "1024x1024" } } },
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: { provider_id: "new-api", channel_parser: "gpt" },
    });
  });

  it("客户端传入的 provider_id 被忽略", () => {
    const parsed = parseModelCreateBody({
      provider_id: "volcengine",
      model_id: "gpt-image-2",
      capability_type: "image",
      model_label: "GPT",
      icon: null,
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: { provider_id: "new-api", channel_parser: "seedream" },
    });
  });

  it("拒绝未知解析器", () => {
    const parsed = parseModelCreateBody({
      model_id: "x",
      capability_type: "image",
      model_label: "x",
      icon: null,
      channel_parser: "jsonpath",
    });
    expect(parsed.ok).toBe(false);
  });

  it("GPT 交叉格拒绝非官方 size", () => {
    const parsed = parseModelCreateBody({
      model_id: "gpt-image-2",
      capability_type: "image",
      model_label: "GPT",
      icon: null,
      channel_parser: "gpt",
      request_mapping: { matrix: { "1k": { "1:1": "1K" } } },
    });
    expect(parsed.ok).toBe(false);
  });
});

describe("parseModelUpdateBody", () => {
  it("更新为 gpt 时必须带 request_mapping", () => {
    const parsed = parseModelUpdateBody({
      channel_parser: "gpt",
    });
    expect(parsed.ok).toBe(false);
  });
});

// IKESD6 / ADR-0085：features 扩展键写侧闸门（读侧宽容降级，写侧必须拒绝脏类型）。
describe("features 扩展键闸门（i2i_model_name / max_prompt_length）", () => {
  const createBase = {
    model_id: "gpt-image-2-x",
    capability_type: "image",
    model_label: "GPT",
    icon: null,
  };

  it("create：合法两新键通过", () => {
    const parsed = parseModelCreateBody({
      ...createBase,
      features: { i2i_model_name: "gpt-image-2-edit", max_prompt_length: 32000 },
    });
    expect(parsed.ok).toBe(true);
  });

  it("create：别名空串 / 非字符串 → 拒绝", () => {
    expect(
      parseModelCreateBody({ ...createBase, features: { i2i_model_name: " " } })
        .ok,
    ).toBe(false);
    expect(
      parseModelCreateBody({ ...createBase, features: { i2i_model_name: 42 } })
        .ok,
    ).toBe(false);
  });

  it("create：max_prompt_length 非正整数 / 越界 → 拒绝", () => {
    for (const bad of [0, -1, 1.5, "32000", 65536]) {
      expect(
        parseModelCreateBody({
          ...createBase,
          features: { max_prompt_length: bad },
        }).ok,
      ).toBe(false);
    }
  });

  it("update：camelCase 键形同样受闸门约束；null 放行（清除配置）", () => {
    expect(
      parseModelUpdateBody({ features: { maxPromptLength: 0 } }).ok,
    ).toBe(false);
    expect(
      parseModelUpdateBody({
        features: { i2i_model_name: null, max_prompt_length: null },
      }).ok,
    ).toBe(true);
  });

  it("未知 features 键不受约束（行为袋向后兼容）", () => {
    const parsed = parseModelCreateBody({
      ...createBase,
      features: { some_future_flag: true },
    });
    expect(parsed.ok).toBe(true);
  });
});
