import { describe, expect, it } from "vitest";

import {
  isValidTagCode,
  listAllTemplateTags,
  listTemplateTags,
  parseTemplateCardForm,
} from "./template-validation.js";

describe("模板标签枚举兜底（可见性）", () => {
  it("listTemplateTags 仅返回可见标签：视频/图片", () => {
    expect(listTemplateTags()).toEqual([
      { tag_code: "video", label: "视频" },
      { tag_code: "picture", label: "图片" },
    ]);
  });

  it("listAllTemplateTags 全量 7 项并带 visible 标记", () => {
    const all = listAllTemplateTags();
    expect(all).toHaveLength(7);
    expect(all.find((t) => t.tag_code === "video")?.visible).toBe(1);
    expect(all.find((t) => t.tag_code === "picture")?.visible).toBe(1);
    expect(all.find((t) => t.tag_code === "marketing")?.visible).toBe(0);
    expect(all.find((t) => t.tag_code === "short")?.visible).toBe(0);
  });

  it("isValidTagCode 新旧 code 均识别，未知拒绝", () => {
    expect(isValidTagCode("video")).toBe(true);
    expect(isValidTagCode("picture")).toBe(true);
    expect(isValidTagCode("short")).toBe(true);
    expect(isValidTagCode("nope")).toBe(false);
  });
});

describe("parseTemplateCardForm 精选字段（IKRE7X）", () => {
  const base = { title: "卡片", tag_code: "video", layout: "wide", sort_order: 1 };
  const tags = new Set(["video"]);

  it("缺省为 0", () => {
    const parsed = parseTemplateCardForm(base, tags);
    expect(parsed.ok && parsed.input.is_featured).toBe(0);
  });

  it("接受 true/false 与 1/0", () => {
    for (const [value, expected] of [
      [true, 1],
      ["1", 1],
      [1, 1],
      [false, 0],
      ["0", 0],
      [0, 0],
    ] as const) {
      const parsed = parseTemplateCardForm({ ...base, is_featured: value }, tags);
      expect(parsed.ok).toBe(true);
      expect(parsed.ok && parsed.input.is_featured).toBe(expected);
    }
  });

  it("拒绝其它取值", () => {
    const parsed = parseTemplateCardForm({ ...base, is_featured: "yes" }, tags);
    expect(parsed.ok).toBe(false);
  });
});
