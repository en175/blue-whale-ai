import { describe, it, expect } from "vitest";
import { richDocToPlainText, isEmptyRichDoc } from "./model";

/** IK55VH richDocToPlainText：连线进下游 prompt 的纯文本派生契约。 */
describe("richDocToPlainText", () => {
  it("mention → @[name]（与 dock/mention.ts extractEditor 契约一致）", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "参考 " },
            { type: "mention", attrs: { id: "n1", label: "产品主图.png" } },
            { type: "text", text: " 构图" },
          ],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe("参考 @[产品主图.png] 构图");
  });

  it("mention 无 label 时回退 @[id]", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "n9" } }],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe("@[n9]");
  });

  it("heading/paragraph 按行，marks（bold/颜色）剥离只留文本", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "标题" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "甲" },
            { type: "text", marks: [{ type: "bold" }], text: "乙" },
            {
              type: "text",
              marks: [{ type: "textStyle", attrs: { color: "#3b82f6" } }],
              text: "丙",
            },
          ],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe("标题\n甲乙丙");
  });

  it("无序/有序列表展平为逐行文本，引用块展平", () => {
    const item = (t: string) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
    });
    const doc = {
      type: "doc",
      content: [
        { type: "bulletList", content: [item("首图白底"), item("加对比表")] },
        { type: "orderedList", content: [item("第一步"), item("第二步")] },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "引用一句" }],
            },
          ],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe(
      "首图白底\n加对比表\n第一步\n第二步\n引用一句",
    );
  });

  it("分割线 → `---` 行；hardBreak → 换行", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上" }] },
        { type: "horizontalRule" },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "下" },
            { type: "hardBreak" },
            { type: "text", text: "一" },
          ],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe("上\n---\n下\n一");
  });

  it("空 doc → 空串；isEmptyRichDoc 判定空卡", () => {
    const empty = { type: "doc", content: [{ type: "paragraph" }] };
    expect(richDocToPlainText(empty)).toBe("");
    expect(isEmptyRichDoc(empty)).toBe(true);
    expect(
      isEmptyRichDoc({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "x" }] },
        ],
      }),
    ).toBe(false);
  });
});
