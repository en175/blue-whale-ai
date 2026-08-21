import { describe, expect, it } from "vitest";

import {
  isValidTagCode,
  listAllTemplateTags,
  listTemplateTags,
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
