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
