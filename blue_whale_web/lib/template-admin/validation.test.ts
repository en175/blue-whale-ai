import { describe, expect, it } from "vitest";

import {
  parseBigId,
  parseMoveDirection,
  parseTemplateCardForm,
} from "./validation";

const TAGS = new Set(["marketing", "image"]);

const VALID_FORM = {
  title: "测试模板",
  tag_code: "marketing",
  layout: "wide",
  sort_order: 3,
  video_url: "https://v.example.com/a.mp4",
  content: "生成一个营销视频",
  images: [
    { id: "12", image_url: "https://i.example.com/1.png" },
    { image_url: "https://i.example.com/2.png" },
  ],
};

describe("parseTemplateCardForm", () => {
  it("合法入参 → 规范化输出（title trim、空值归一）", () => {
    const result = parseTemplateCardForm(VALID_FORM, TAGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toEqual({
      title: "测试模板",
      tag_code: "marketing",
      layout: "wide",
      sort_order: 3,
      video_url: "https://v.example.com/a.mp4",
      content: "生成一个营销视频",
      images: [
        { id: "12", image_url: "https://i.example.com/1.png" },
        { image_url: "https://i.example.com/2.png" },
      ],
    });
  });

  it("可选字段缺省 → null/空数组", () => {
    const result = parseTemplateCardForm(
      { title: "T", tag_code: "image", layout: "image", sort_order: 0 },
      TAGS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.video_url).toBeNull();
    expect(result.input.content).toBeNull();
    expect(result.input.images).toEqual([]);
  });

  it("layout 四种合法值都通过；其余拒绝", () => {
    for (const layout of ["wide", "portrait", "social", "image"]) {
      const r = parseTemplateCardForm({ ...VALID_FORM, layout }, TAGS);
      expect(r.ok).toBe(true);
    }
    const bad = parseTemplateCardForm({ ...VALID_FORM, layout: "huge" }, TAGS);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("layout");
  });

  it("非法 tag / 空标题 / 负排序 / 非法图片 id 逐一拒绝", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...VALID_FORM, tag_code: "unknown" }, "标签无效"],
      [{ ...VALID_FORM, title: "  " }, "标题必填"],
      [{ ...VALID_FORM, sort_order: -1 }, "sort_order"],
      [{ ...VALID_FORM, sort_order: 1.5 }, "sort_order"],
      [
        { ...VALID_FORM, images: [{ id: "abc", image_url: "https://x" }] },
        "id 无效",
      ],
      [{ ...VALID_FORM, images: [{ image_url: "" }] }, "URL 必填"],
      [{ ...VALID_FORM, video_url: 123 }, "video_url"],
    ];
    for (const [form, keyword] of cases) {
      const r = parseTemplateCardForm(form, TAGS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain(keyword);
    }
  });

  it("图片超过 20 张拒绝；重复 image id 拒绝；sort_order 超 Int32 拒绝", () => {
    const images = Array.from({ length: 21 }, (_, i) => ({
      image_url: `https://x/${i}.png`,
    }));
    expect(parseTemplateCardForm({ ...VALID_FORM, images }, TAGS).ok).toBe(
      false,
    );

    const dup = parseTemplateCardForm(
      {
        ...VALID_FORM,
        images: [
          { id: "7", image_url: "https://x/a.png" },
          { id: "7", image_url: "https://x/b.png" },
        ],
      },
      TAGS,
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain("重复");

    const big = parseTemplateCardForm(
      { ...VALID_FORM, sort_order: 99999999999 },
      TAGS,
    );
    expect(big.ok).toBe(false);
  });
});

describe("parseBigId / parseMoveDirection", () => {
  it("正整数字符串 → bigint；其余 → null", () => {
    expect(parseBigId("42")).toBe(BigInt(42));
    expect(parseBigId("0")).toBeNull();
    expect(parseBigId("-1")).toBeNull();
    expect(parseBigId("1.5")).toBeNull();
    expect(parseBigId("abc")).toBeNull();
    expect(parseBigId(42 as unknown)).toBeNull();
  });

  it("方向仅接受 up/down", () => {
    expect(parseMoveDirection("up")).toBe("up");
    expect(parseMoveDirection("down")).toBe("down");
    expect(parseMoveDirection("left")).toBeNull();
    expect(parseMoveDirection(undefined)).toBeNull();
  });
});
