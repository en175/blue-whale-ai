import { describe, expect, it } from "vitest";
import {
  PROMPT_DOC_VERSION,
  compilePromptDoc,
  compileVideoPromptDoc,
  imageRefLabel,
  promptDocSchema,
  validatePromptDocRefs,
  validateVideoPromptDocRefs,
  videoRefLabel,
} from "./prompt-doc.js";

/* IKFA1M：正文素材标签（prompt_doc）契约——正文/标签结构、编号派生、编译与接纳前校验。
   语义权威文档：docs/specs/2026-09-12-ikfa1m-image-prompt-ref-contract.md
   IKFA1O：视频扩展——素材库身份（asset- 前缀）、首尾帧角色标签与同类型连续编号。 */

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

  it("asset_id 接受本地纯数字 id 与素材库 asset- 前缀 id（IKFA1O），其余拒绝", () => {
    const bad = (asset_id: string) =>
      promptDocSchema.safeParse({ version: 1, segments: [{ kind: "asset_ref", asset_id }] }).success;
    expect(bad("abc")).toBe(false);
    expect(bad("Asset-x")).toBe(true); // 素材库前缀大小写不敏感（与生成接纳 materialId 同口径）
    expect(bad("asset-20260820153209-6c9z8")).toBe(true);
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

/* ================= IKFA1O：视频多媒体标签与首尾帧角色 ================= */

/** 视频参考集合（buildVideoJobReferences 同构：帧在前、普通参考保序） */
const VIDEO_REFS = [
  { id: "201", role: "first_frame", type: "image" },
  { id: "202", role: "last_frame", type: "image" },
  { id: "101", role: "reference", type: "image" },
  { id: "102", role: "reference", type: "image" },
  { id: "301", role: "reference", type: "video" },
  { id: "asset-20260820153209-6c9z8", role: "reference", type: "video" },
  { id: "401", role: "reference", type: "audio" },
] as const;

describe("videoRefLabel（视频标签文案派生，IKFA1O）", () => {
  it("首帧/尾帧按角色显示，不编号", () => {
    expect(videoRefLabel("201", VIDEO_REFS)).toBe("首帧");
    expect(videoRefLabel("202", VIDEO_REFS)).toBe("尾帧");
  });

  it("普通参考按同类型在 reference 序中的顺序连续编号（图片N/视频N/音频N）", () => {
    expect(videoRefLabel("101", VIDEO_REFS)).toBe("图片1");
    expect(videoRefLabel("102", VIDEO_REFS)).toBe("图片2");
    expect(videoRefLabel("301", VIDEO_REFS)).toBe("视频1");
    expect(videoRefLabel("asset-20260820153209-6c9z8", VIDEO_REFS)).toBe("视频2");
    expect(videoRefLabel("401", VIDEO_REFS)).toBe("音频1");
  });

  it("身份不在参考集合返回 null（失效）", () => {
    expect(videoRefLabel("999", VIDEO_REFS)).toBeNull();
  });
});

describe("validateVideoPromptDocRefs（视频接纳前校验，IKFA1O）", () => {
  it("全部有效返回 null（含素材库身份）", () => {
    const doc = promptDocSchema.parse({
      version: 1,
      segments: [
        { kind: "text", text: "从" },
        { kind: "asset_ref", asset_id: "201" },
        { kind: "text", text: "过渡到" },
        { kind: "asset_ref", asset_id: "202" },
        { kind: "text", text: "，风格参考" },
        { kind: "asset_ref", asset_id: "asset-20260820153209-6c9z8" },
      ],
    });
    expect(validateVideoPromptDocRefs(doc, VIDEO_REFS)).toBeNull();
  });

  it("失效标签 → invalid_tag（模式不兼容/参考移除均由 invalid_label 承载）", () => {
    const doc = promptDocSchema.parse({
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: "101", invalid_label: "图片1" }],
    });
    expect(validateVideoPromptDocRefs(doc, VIDEO_REFS)).toEqual({
      kind: "invalid_tag",
      assetId: "101",
    });
  });

  it("标签身份不在 references（asset_id ∪ material_id）→ unknown_asset", () => {
    const doc = promptDocSchema.parse({
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: "999" }],
    });
    expect(validateVideoPromptDocRefs(doc, VIDEO_REFS)).toEqual({
      kind: "unknown_asset",
      assetId: "999",
    });
  });
});

describe("compileVideoPromptDoc（视频正文编译，IKFA1O）", () => {
  it("帧标签编译为首帧/尾帧，普通参考按同类型编号，多次提及同一文案（A2/A4/C1）", () => {
    const doc = promptDocSchema.parse({
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: "102" },
        { kind: "text", text: "的人物从" },
        { kind: "asset_ref", asset_id: "201" },
        { kind: "text", text: "走向" },
        { kind: "asset_ref", asset_id: "202" },
        { kind: "text", text: "，参考" },
        { kind: "asset_ref", asset_id: "301" },
        { kind: "text", text: "的运镜，再回到" },
        { kind: "asset_ref", asset_id: "102" },
      ],
    });
    expect(compileVideoPromptDoc(doc, VIDEO_REFS)).toBe(
      "让图片2的人物从首帧走向尾帧，参考视频1的运镜，再回到图片2",
    );
  });

  it("带失效标签或未知身份直接抛错（调用方必须先过 validateVideoPromptDocRefs）", () => {
    const invalid = promptDocSchema.parse({
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: "101", invalid_label: "图片1" }],
    });
    expect(() => compileVideoPromptDoc(invalid, VIDEO_REFS)).toThrow();
    const unknown = promptDocSchema.parse({
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: "999" }],
    });
    expect(() => compileVideoPromptDoc(unknown, VIDEO_REFS)).toThrow();
  });
});
