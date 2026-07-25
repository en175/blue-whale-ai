// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  buildPill,
  insertMention,
  removeMention,
  extractEditor,
  type MentionItem,
} from "./mention";

function imageItem(overrides: Partial<MentionItem> = {}): MentionItem {
  return {
    id: "asset-9",
    type: "image",
    name: "蓝鲸素材",
    src: "/img/9.png",
    assetId: 9,
    ...overrides,
  };
}

function setup(html: string): HTMLElement {
  document.body.innerHTML = `<div id="editor" contenteditable="true">${html}</div>`;
  return document.getElementById("editor")!;
}

function pill(attrs: {
  id: string;
  name: string;
  assetId?: number;
  label?: string;
}): string {
  const asset =
    attrs.assetId == null ? "" : ` data-mention-asset-id="${attrs.assetId}"`;
  return `<span data-mention-id="${attrs.id}" data-mention-name="${attrs.name}"${asset} contenteditable="false">${attrs.label ?? attrs.name}</span>`;
}

describe("buildPill", () => {
  it("写入 mention 身份与 assetId 属性，并锁定为不可编辑", () => {
    const el = buildPill(imageItem());
    expect(el.getAttribute("data-mention-id")).toBe("asset-9");
    expect(el.getAttribute("data-mention-name")).toBe("蓝鲸素材");
    expect(el.getAttribute("data-mention-asset-id")).toBe("9");
    expect(el.getAttribute("data-mention-type")).toBe("image");
    expect(el.getAttribute("data-mention-src")).toBe("/img/9.png");
    expect(el.getAttribute("contenteditable")).toBe("false");
  });

  it("无 assetId 时不写 data-mention-asset-id", () => {
    const el = buildPill({ id: "asset-9", type: "image", name: "蓝鲸" });
    expect(el.hasAttribute("data-mention-asset-id")).toBe(false);
  });

  it("颜色用设计 token 而非硬编码 rgba", () => {
    const el = buildPill(imageItem());
    expect(el.style.cssText).toContain("var(--tc-border)");
    expect(el.style.cssText).toContain("var(--tc-text-secondary)");
    expect(el.style.cssText).not.toContain("rgba(255,255,255,0.1)");
  });
});

describe("extractEditor", () => {
  it("单 pill 序列化为 @[name] 并返回数字 assetIds", () => {
    const editor = setup(pill({ id: "a", name: "蓝鲸", assetId: 9 }));
    const result = extractEditor(editor);
    expect(result.prompt).toBe("@[蓝鲸]");
    expect(result.assetIds).toEqual([9]);
  });

  it("多 pill 保留 DOM 出现顺序", () => {
    const editor = setup(
      `${pill({ id: "a", name: "A", assetId: 3 })}x${pill({ id: "b", name: "B", assetId: 7 })}`,
    );
    expect(extractEditor(editor).assetIds).toEqual([3, 7]);
  });

  it("重复 assetId 去重：content @[name] 与 assetIds 一一对应（防复制粘贴 pill 错位）", () => {
    const editor = setup(
      `${pill({ id: "a", name: "A", assetId: 3 })}${pill({ id: "b", name: "B", assetId: 3 })}`,
    );
    const result = extractEditor(editor);
    expect(result.prompt).toBe("@[A]");
    expect(result.assetIds).toEqual([3]);
  });

  it("纯文本技能 mention @skill 原样保留，不计入 assetIds", () => {
    const editor = setup("@文生图 帮我画一只鲸鱼");
    const result = extractEditor(editor);
    expect(result.prompt).toBe("@文生图 帮我画一只鲸鱼");
    expect(result.assetIds).toEqual([]);
  });

  it("pill 与纯文本混合", () => {
    const editor = setup(
      `参考 ${pill({ id: "a", name: "蓝鲸", assetId: 9 })} 这张`,
    );
    const result = extractEditor(editor);
    expect(result.prompt).toBe("参考 @[蓝鲸] 这张");
    expect(result.assetIds).toEqual([9]);
  });

  it("无 pill 时 assetIds 为空", () => {
    expect(extractEditor(setup("纯文本提示")).assetIds).toEqual([]);
  });
});

describe("removeMention", () => {
  it("删除 pill 并触发 input 事件", () => {
    const editor = setup(pill({ id: "a", name: "A", assetId: 3 }));
    const spy = vi.fn();
    editor.addEventListener("input", spy);
    removeMention(editor, "a");
    expect(editor.querySelector('[data-mention-id="a"]')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("insertMention", () => {
  it("在编辑器内插入 pill 并携带 assetId", () => {
    const editor = setup("前文");
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    vi.stubGlobal("getSelection", () => ({
      rangeCount: 1,
      getRangeAt: () => range,
      removeAllRanges: () => {},
      addRange: () => {},
    }));

    insertMention(editor, imageItem());

    const inserted = editor.querySelector('[data-mention-id="asset-9"]');
    expect(inserted).not.toBeNull();
    expect(inserted!.getAttribute("data-mention-asset-id")).toBe("9");

    vi.unstubAllGlobals();
  });
});
