// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  buildPill,
  insertMention,
  removeMention,
  extractEditor,
  markMentionFailures,
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
  assetId?: number | string;
  sceneCardId?: number | string;
  sceneCardVersion?: number;
  label?: string;
}): string {
  const asset =
    attrs.assetId == null ? "" : ` data-mention-asset-id="${attrs.assetId}"`;
  const scene =
    attrs.sceneCardId == null
      ? ""
      : ` data-mention-type="scene_card" data-mention-scene-card-id="${attrs.sceneCardId}" data-mention-scene-card-version="${attrs.sceneCardVersion}"`;
  return `<span data-mention-id="${attrs.id}" data-mention-name="${attrs.name}"${asset}${scene} contenteditable="false">${attrs.label ?? attrs.name}</span>`;
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

  it("video 类型 pill 渲染 🎬 图标占位且 type 属性正确", () => {
    const el = buildPill({ id: "v1", type: "video", name: "产品演示" });
    expect(el.getAttribute("data-mention-type")).toBe("video");
    expect(el.textContent).toContain("🎬");
    expect(el.textContent).toContain("产品演示");
  });

  it("audio 类型 pill 渲染 🎵 图标占位且 type 属性正确", () => {
    const el = buildPill({ id: "a1", type: "audio", name: "背景音乐" });
    expect(el.getAttribute("data-mention-type")).toBe("audio");
    expect(el.textContent).toContain("🎵");
    expect(el.textContent).toContain("背景音乐");
  });

  it("video 带 src 时渲染缩略图而非图标", () => {
    const el = buildPill({
      id: "v2",
      type: "video",
      name: "视频",
      src: "/vid/thumb.png",
    });
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.src).toContain("/vid/thumb.png");
  });

  it("SceneCard pill 写入稳定身份和被引用版本", () => {
    const el = buildPill({
      id: "scene-12",
      type: "scene_card",
      name: "开场分镜",
      sceneCardId: 12,
      sceneCardVersion: 3,
    });
    expect(el.getAttribute("data-mention-type")).toBe("scene_card");
    expect(el.getAttribute("data-mention-scene-card-id")).toBe("12");
    expect(el.getAttribute("data-mention-scene-card-version")).toBe("3");
  });
});

describe("extractEditor", () => {
  it("超大 asset ID 保持十进制字符串精度", () => {
    const assetId = "9007199254740993";
    const editor = setup(pill({ id: "a", name: "蓝鲸", assetId }));

    expect(extractEditor(editor).assetIds).toEqual([assetId]);
  });

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

  it("按 DOM 顺序提取统一 AssetMention 与 SceneCardMention 集合", () => {
    const editor = setup(
      `${pill({ id: "scene", name: "开场", sceneCardId: 12, sceneCardVersion: 3 })}${pill({ id: "asset", name: "蓝鲸", assetId: 9 })}`,
    );
    expect(extractEditor(editor).mentions).toEqual([
      {
        type: "scene_card",
        scene_card_id: "12",
        scene_card_version: 3,
        display_name: "开场",
      },
      { type: "asset", asset_id: "9", display_name: "蓝鲸" },
    ]);
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

  it("失效 pill 标记原因并提供可点击的移除入口", () => {
    const editor = setup(pill({ id: "a", name: "A", assetId: 3 }));
    markMentionFailures(editor, [
      { index: 0, type: "asset", reason: "permission_lost" },
    ]);

    const marked = editor.querySelector<HTMLElement>(
      '[data-mention-availability="unavailable"]',
    );
    expect(marked?.getAttribute("data-mention-reason")).toBe("permission_lost");
    expect(marked?.style.outline).toContain("var(--tc-destructive)");
    expect(marked?.querySelector("[data-mention-remove]")).not.toBeNull();
  });

  it("Asset 与 SceneCard 数值 ID 相同时只移除被点击的失效 pill", () => {
    const editor = setup(
      `${pill({ id: "9", name: "素材", assetId: 9 })}${pill({ id: "9", name: "分镜", sceneCardId: 9, sceneCardVersion: 1 })}`,
    );
    markMentionFailures(editor, [
      { index: 1, type: "scene_card", reason: "stale" },
    ]);

    editor.querySelector<HTMLButtonElement>("[data-mention-remove]")?.click();

    expect(editor.querySelector('[data-mention-asset-id="9"]')).not.toBeNull();
    expect(editor.querySelector('[data-mention-scene-card-id="9"]')).toBeNull();
  });

  it("新一轮失败集合会清理已恢复引用的旧标记", () => {
    const editor = setup(
      `${pill({ id: "a", name: "A", assetId: 3 })}${pill({ id: "b", name: "B", assetId: 7 })}`,
    );
    markMentionFailures(editor, [
      { index: 0, type: "asset", reason: "permission_lost" },
    ]);
    markMentionFailures(editor, [
      { index: 1, type: "asset", reason: "deleted" },
    ]);

    const first = editor.querySelector<HTMLElement>(
      '[data-mention-asset-id="3"]',
    );
    const second = editor.querySelector<HTMLElement>(
      '[data-mention-asset-id="7"]',
    );
    expect(first?.hasAttribute("data-mention-availability")).toBe(false);
    expect(first?.querySelector("[data-mention-remove]")).toBeNull();
    expect(first?.style.color).toBe("var(--tc-text-secondary)");
    expect(second?.getAttribute("data-mention-reason")).toBe("deleted");
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
