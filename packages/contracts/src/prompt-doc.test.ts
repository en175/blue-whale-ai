import { describe, expect, it } from "vitest";
import {
  PROMPT_DOC_VERSION,
  compilePromptDoc,
  compileVideoPromptDoc,
  docHasTextRef,
  imageRefLabel,
  promptDocSchema,
  textRefLabel,
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

/* IKFA1P：文本附件正文标签——text_ref 结构、文本N 编号、与媒体标签混排编译、
   文本身份复核。语义权威：docs/specs/2026-09-13-ikfa1p-text-attachment-prompt-ref-contract.md */

const TEXT_NODES = ["text-1770000000000-3", "text-1770000000005-7"];

describe("text_ref（文本片段结构，IKFA1P）", () => {
  it("合法结构通过：node_id 为来源画布文本节点 id", () => {
    expect(
      promptDocSchema.safeParse({
        version: 1,
        segments: [{ kind: "text_ref", node_id: TEXT_NODES[0] }],
      }).success,
    ).toBe(true);
  });

  it("node_id 空串 / 超长拒绝；与媒体身份混排通过", () => {
    expect(
      promptDocSchema.safeParse({ version: 1, segments: [{ kind: "text_ref", node_id: "" }] })
        .success,
    ).toBe(false);
    expect(
      promptDocSchema.safeParse({
        version: 1,
        segments: [
          { kind: "text", text: "按" },
          { kind: "text_ref", node_id: TEXT_NODES[0] },
          { kind: "text", text: "修改" },
          { kind: "asset_ref", asset_id: "101" },
        ],
      }).success,
    ).toBe(true);
  });

  it("strict 语义：text_ref 未知字段拒绝", () => {
    expect(
      promptDocSchema.safeParse({
        version: 1,
        segments: [{ kind: "text_ref", node_id: "n1", extra: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("textRefLabel / docHasTextRef（文本编号派生，IKFA1P）", () => {
  it("文本N = node_id 在文本附件顺序中的下标 + 1；不在集合返回 null", () => {
    expect(textRefLabel(TEXT_NODES[1], TEXT_NODES)).toBe("文本2");
    expect(textRefLabel("text-gone", TEXT_NODES)).toBeNull();
    expect(textRefLabel(TEXT_NODES[0], undefined)).toBeNull();
  });

  it("docHasTextRef 只认 text_ref 片段", () => {
    expect(docHasTextRef(promptDocSchema.parse({ version: 1, segments: [{ kind: "text", text: "文本1" }] }))).toBe(false);
    expect(
      docHasTextRef(promptDocSchema.parse({ version: 1, segments: [{ kind: "asset_ref", asset_id: "1" }] })),
    ).toBe(false);
    expect(
      docHasTextRef(promptDocSchema.parse({ version: 1, segments: [{ kind: "text_ref", node_id: "n1" }] })),
    ).toBe(true);
  });
});

describe("validate/compile 文本扩展（IKFA1P）", () => {
  const MIXED = promptDocSchema.parse({
    version: 1,
    segments: [
      { kind: "text", text: "按" },
      { kind: "text_ref", node_id: TEXT_NODES[0] },
      { kind: "text", text: "修改" },
      { kind: "asset_ref", asset_id: "101" },
      { kind: "text", text: "，再参考" },
      { kind: "text_ref", node_id: TEXT_NODES[1] },
    ],
  });

  it("生图：文本身份不在附件集合 → unknown_text；附件顺序缺省同样 unknown_text", () => {
    expect(validatePromptDocRefs(MIXED, ["101"], TEXT_NODES)).toBeNull();
    expect(validatePromptDocRefs(MIXED, ["101"], [TEXT_NODES[0]])).toEqual({
      kind: "unknown_text",
      nodeId: TEXT_NODES[1],
    });
    expect(validatePromptDocRefs(MIXED, ["101"])).toEqual({
      kind: "unknown_text",
      nodeId: TEXT_NODES[0],
    });
  });

  it("生图：文本失效标签 → invalid_tag（阻止生成）", () => {
    const doc = promptDocSchema.parse({
      version: 1,
      segments: [{ kind: "text_ref", node_id: TEXT_NODES[0], invalid_label: "文本1" }],
    });
    expect(validatePromptDocRefs(doc, [], TEXT_NODES)).toEqual({
      kind: "invalid_tag",
      assetId: TEXT_NODES[0],
    });
  });

  it("生图编译：文本N 与图片N 混排、多次提及同一编号（E4）", () => {
    const doc = promptDocSchema.parse({
      version: 1,
      segments: [
        { kind: "text", text: "按" },
        { kind: "text_ref", node_id: TEXT_NODES[0] },
        { kind: "text", text: "改，再提" },
        { kind: "text_ref", node_id: TEXT_NODES[0] },
        { kind: "text", text: "和" },
        { kind: "asset_ref", asset_id: "101" },
      ],
    });
    expect(compilePromptDoc(doc, ["101"], TEXT_NODES)).toBe("按文本1改，再提文本1和图片1");
  });

  it("生图编译：含 text_ref 但未传附件顺序直接抛错", () => {
    expect(() => compilePromptDoc(MIXED, ["101"])).toThrow();
  });

  it("视频：文本与首尾帧/普通参考混排编译；unknown_text 复核同生图", () => {
    const doc = promptDocSchema.parse({
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: "201" },
        { kind: "text", text: "按" },
        { kind: "text_ref", node_id: TEXT_NODES[1] },
        { kind: "text", text: "调整" },
      ],
    });
    expect(compileVideoPromptDoc(doc, VIDEO_REFS, TEXT_NODES)).toBe("让首帧按文本2调整");
    expect(validateVideoPromptDocRefs(doc, VIDEO_REFS)).toEqual({
      kind: "unknown_text",
      nodeId: TEXT_NODES[1],
    });
    expect(() => compileVideoPromptDoc(doc, VIDEO_REFS)).toThrow();
  });
});
