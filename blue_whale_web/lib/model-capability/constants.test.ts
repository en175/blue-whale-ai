import { describe, expect, it } from "vitest";

import {
  MODEL_CAPABILITY_LABELS,
  parseModelCreateBody,
  parseModelUpdateBody,
} from "./constants";

const VALID = {
  provider_id: "volcengine",
  model_id: "doubao-seedream-4-0-250828",
  capability_type: "image",
  model_label: "豆包 Seedream 4.0",
  supported_sizes: [{ id: "1k", label: "1K" }],
  supported_aspect_ratios: ["1:1", "16:9"],
  supported_formats: ["png", "jpeg"],
  default_size: "1K",
  default_aspect_ratio: "1:1",
  features: { stream: true },
  enabled: true,
};

describe("parseModelCreateBody", () => {
  it("合法 payload 通过，空 JSON 列补默认、icon/format/duration 归一化为 null", () => {
    const r = parseModelCreateBody(VALID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      provider_id: "volcengine",
      model_id: "doubao-seedream-4-0-250828",
      capability_type: "image",
      model_label: "豆包 Seedream 4.0",
      supported_sizes: [{ id: "1k", label: "1K" }],
      supported_aspect_ratios: ["1:1", "16:9"],
      features: { stream: true },
      enabled: true,
    });
    expect(r.value.icon).toBeNull();
    expect(r.value.supported_durations).toBeNull();
    expect(r.value.default_format).toBeNull();
    expect(r.value.default_duration).toBeNull();
  });

  it("capability_type 非 image/video/text → 拒绝", () => {
    expect(
      parseModelCreateBody({ ...VALID, capability_type: "audio" }).ok,
    ).toBe(false);
  });

  it("身份字段空 / 超长 → 拒绝（防 VarChar 截断）", () => {
    expect(parseModelCreateBody({ ...VALID, model_id: "" }).ok).toBe(false);
    expect(
      parseModelCreateBody({ ...VALID, model_label: "长".repeat(65) }).ok,
    ).toBe(false);
    expect(
      parseModelCreateBody({ ...VALID, provider_id: "长".repeat(33) }).ok,
    ).toBe(false);
  });

  it("JSON 列形状非法 → 拒绝", () => {
    expect(parseModelCreateBody({ ...VALID, supported_sizes: [1, 2] }).ok).toBe(
      false,
    );
    expect(
      parseModelCreateBody({ ...VALID, supported_sizes: [{ label: "1K" }] }).ok,
    ).toBe(false);
    expect(
      parseModelCreateBody({ ...VALID, supported_aspect_ratios: "1:1" }).ok,
    ).toBe(false);
    expect(parseModelCreateBody({ ...VALID, features: ["a"] }).ok).toBe(false);
  });

  it("supported_durations 接受 null 或数字数组，拒绝其它", () => {
    expect(
      parseModelCreateBody({ ...VALID, supported_durations: null }).ok,
    ).toBe(true);
    expect(
      parseModelCreateBody({ ...VALID, supported_durations: [5, 10] }).ok,
    ).toBe(true);
    expect(
      parseModelCreateBody({ ...VALID, supported_durations: "5" }).ok,
    ).toBe(false);
  });

  it("default_duration 只接受 [0, 2^31-1] 整数或 null", () => {
    expect(parseModelCreateBody({ ...VALID, default_duration: 5 }).ok).toBe(
      true,
    );
    expect(parseModelCreateBody({ ...VALID, default_duration: null }).ok).toBe(
      true,
    );
    expect(parseModelCreateBody({ ...VALID, default_duration: 2.5 }).ok).toBe(
      false,
    );
    expect(parseModelCreateBody({ ...VALID, default_duration: -1 }).ok).toBe(
      false,
    );
    expect(
      parseModelCreateBody({ ...VALID, default_duration: 2_147_483_648 }).ok,
    ).toBe(false);
  });

  it("enabled 非布尔 → 拒绝（防 'false' 字符串被静默当 true）", () => {
    expect(parseModelCreateBody({ ...VALID, enabled: "false" }).ok).toBe(false);
  });

  it("非对象请求体 → 拒绝", () => {
    expect(parseModelCreateBody([1, 2]).ok).toBe(false);
  });
});

describe("parseModelUpdateBody", () => {
  it("只透传已提供的可编辑字段，身份字段不在输出", () => {
    const r = parseModelUpdateBody({ model_label: "新名", enabled: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ model_label: "新名", enabled: false });
    expect(r.value).not.toHaveProperty("provider_id");
  });

  it("JSON 列形状非法 → 拒绝", () => {
    expect(parseModelUpdateBody({ supported_sizes: 3 }).ok).toBe(false);
    expect(parseModelUpdateBody({ features: "x" }).ok).toBe(false);
  });

  it("sort_order 负值 / 非整数 → 拒绝", () => {
    expect(parseModelUpdateBody({ sort_order: -1 }).ok).toBe(false);
    expect(parseModelUpdateBody({ sort_order: 1.5 }).ok).toBe(false);
    expect(parseModelUpdateBody({ sort_order: 3 }).ok).toBe(true);
  });

  it("default_duration 超范围 → 拒绝", () => {
    expect(parseModelUpdateBody({ default_duration: 2_147_483_648 }).ok).toBe(
      false,
    );
  });
});

describe("MODEL_CAPABILITY_LABELS", () => {
  it("三种能力类型都有中文标签", () => {
    expect(MODEL_CAPABILITY_LABELS).toEqual({
      image: "图片",
      video: "视频",
      text: "文生文",
    });
  });
});
