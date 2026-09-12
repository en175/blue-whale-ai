import { describe, expect, it } from "vitest";
import {
  PROMPT_DOC_VERSION,
  compilePromptDoc,
  imageRefLabel,
  promptDocSchema,
  validatePromptDocRefs,
} from "./prompt-doc.js";

/* IKFA1M：正文素材标签（prompt_doc）契约——正文/标签结构、编号派生、编译与接纳前校验。
   语义权威文档：docs/specs/2026-09-12-ikfa1m-image-prompt-ref-contract.md */

const DOC_BASE = {
  version: PROMPT_DOC_VERSION,
  segments: [
    { kind: "text", text: "让" },
    { kind: "asset_ref", asset_id: "101" },
    { kind: "text", text: "的人物穿上" },
    { kind: "asset_ref", asset_id: "102" },
    { kind: "text", text: "的衣服" },
  ],
} as const;

describe("promptDocSchema（结构契约）", () => {
  it("合法结构通过：文字与标签交替，version=1", () => {
    const parsed = promptDocSchema.safeParse(DOC_BASE);
    expect(parsed.success).toBe(true);
  });

  it("version 非 1 拒绝（旧/新格式不猜造）", () => {
    expect(promptDocSchema.safeParse({ ...DOC_BASE, version: 2 }).success).toBe(false);
    expect(promptDocSchema.safeParse({ segments: DOC_BASE.segments }).success).toBe(false);
  });

  it("asset_id 必须是本地 Asset 纯数字 id（非数字/素材库前缀/URL 均拒绝）", () => {
    const bad = (asset_id: string) =>
      promptDocSchema.safeParse({ version: 1, segments: [{ kind: "asset_ref", asset_id }] }).success;
    expect(bad("abc")).toBe(false);
    expect(bad("asset-2026")).toBe(false);
    expect(bad("https://x/1.png")).toBe(false);
    expect(bad("0")).toBe(false);
    expect(bad("101")).toBe(true);
  });

  it("失效标签：invalid_label 可选但携带时必须非空", () => {
    expect(
      promptDocSchema.safeParse({
        version: 1,
        segments: [{ kind: "asset_ref", asset_id: "101", invalid_label: "图片2" }],
      }).success,
    ).toBe(true);
    expect(
      promptDocSchema.safeParse({
        version: 1,
        segments: [{ kind: "asset_ref", asset_id: "101", invalid_label: "" }],
      }).success,
    ).toBe(false);
  });

  it("strict 语义：未知字段与未知 kind 拒绝", () => {
    expect(
      promptDocSchema.safeParse({ ...DOC_BASE, extra: 1 }).success,
    ).toBe(false);
    expect(
      promptDocSchema.safeParse({ version: 1, segments: [{ kind: "ref", id: "1" }] }).success,
    ).toBe(false);
    expect(
      promptDocSchema.safeParse({
        version: 1,
        segments: [{ kind: "text", text: "a", label: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("imageRefLabel（编号派生）", () => {
  it("编号 = asset_id 在最终输入顺序中的下标 + 1", () => {
    expect(imageRefLabel("101", ["101", "102", "103"])).toBe("图片1");
    expect(imageRefLabel("103", ["101", "102", "103"])).toBe("图片3");
  });

  it("先提图片2 再提图片1：编号跟真实输入顺序，不跟正文出现顺序（D1）", () => {
    const ordered = ["101", "102"]; // 真实媒体输入顺序
    expect(imageRefLabel("102", ordered)).toBe("图片2");
    expect(imageRefLabel("101", ordered)).toBe("图片1");
  });

  it("身份不在有效输入集合中返回 null（失效，不转向其他素材）", () => {
    expect(imageRefLabel("999", ["101", "102"])).toBeNull();
  });
});

describe("compilePromptDoc（按真实输入顺序编译正文）", () => {
  it("标签替换为 图片N，文字原样拼接，多次提及同一编号（A4）", () => {
    const doc = promptDocSchema.parse({
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: "102" },
        { kind: "text", text: "穿上" },
        { kind: "asset_ref", asset_id: "101" },
        { kind: "text", text: "的衣服，再让" },
        { kind: "asset_ref", asset_id: "102" },
        { kind: "text", text: "微笑" },
      ],
    });
    // 正文先提 102 再提 101，媒体顺序仍是 101/102
    expect(compilePromptDoc(doc, ["101", "102"])).toBe(
      "让图片2穿上图片1的衣服，再让图片2微笑",
    );
  });

  it("带失效标签或未知身份直接抛错（调用方必须先过 validatePromptDocRefs）", () => {
    const invalid = promptDocSchema.parse({
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: "101", invalid_label: "图片1" }],
    });
    expect(() => compilePromptDoc(invalid, ["101"])).toThrow();
    const unknown = promptDocSchema.parse({
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: "999" }],
    });
    expect(() => compilePromptDoc(unknown, ["101"])).toThrow();
  });
});

describe("validatePromptDocRefs（接纳前校验）", () => {
  it("全部有效返回 null", () => {
    const doc = promptDocSchema.parse(DOC_BASE);
    expect(validatePromptDocRefs(doc, ["101", "102"])).toBeNull();
  });

  it("失效标签 → invalid_tag（存在失效标签阻止生成）", () => {
    const doc = promptDocSchema.parse({
      version: 1,
      segments: [
        { kind: "asset_ref", asset_id: "101", invalid_label: "图片2" },
        { kind: "asset_ref", asset_id: "102" },
      ],
    });
    expect(validatePromptDocRefs(doc, ["101", "102"])).toEqual({
      kind: "invalid_tag",
      assetId: "101",
    });
  });

  it("标签指向不在最终输入集合的身份 → unknown_asset（服务端复核引用关系）", () => {
    const doc = promptDocSchema.parse(DOC_BASE);
    expect(validatePromptDocRefs(doc, ["101"])).toEqual({
      kind: "unknown_asset",
      assetId: "102",
    });
  });
});
