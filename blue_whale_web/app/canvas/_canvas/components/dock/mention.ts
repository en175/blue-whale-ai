/**
 * mention —— contentEditable 参考图 pill 工具
 *
 * 在 contentEditable 编辑器内插入/移除参考图 mention pill，
 * 并从编辑器 DOM 中提取纯文本 prompt 与参考图 URL 列表。
 */
import {
  isWireInteger,
  wireInteger,
  type WireInteger,
} from "@/lib/wire-integer";
import type {
  ConversationMentionInput,
  MentionFailure,
} from "@blue-whale/core";

/** 参考图 mention 条目 */
export type MentionItem = {
  id: string;
  type: "image" | "video" | "audio" | "scene_card";
  name: string;
  src?: string;
  assetId?: WireInteger;
  sceneCardId?: WireInteger;
  sceneCardVersion?: number;
};

const MENTION_ATTR = "data-mention-id";

/** 在 contentEditable 编辑器光标处插入 mention pill。replace=true 时清空编辑器只保留该 pill。 */
export function insertMention(
  el: HTMLElement,
  item: MentionItem,
  opts?: { replace?: boolean },
): void {
  if (opts?.replace) {
    el.innerHTML = "";
  }

  // 确保编辑器聚焦，光标在末尾
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;

  // 若无可用的 range，将光标放到编辑器末尾
  let range: Range;
  try {
    if (sel.rangeCount > 0) {
      range = sel.getRangeAt(0);
      // 确保 range 在目标编辑器内
      if (!el.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
  } catch {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }

  // 构建 pill 元素
  const pill = buildPill(item);

  // 在光标处插入 pill
  range.deleteContents();
  range.insertNode(pill);

  // pill 后加一个空格方便继续输入
  const space = document.createTextNode(" ");
  range.setStartAfter(pill);
  range.collapse(true);
  range.insertNode(space);

  // 光标移到空格后
  range.setStartAfter(space);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  // 触发 input 事件让 React 感知变化
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 从编辑器中移除指定 id 的 mention pill */
function removeMentionElement(el: HTMLElement, pill: Element): void {
  // 移除 pill 前可能的前导换行/空格，以及之后的空格
  const prev = pill.previousSibling;
  if (
    prev &&
    prev.nodeType === Node.TEXT_NODE &&
    prev.textContent?.trim() === ""
  ) {
    prev.remove();
  }
  const next = pill.nextSibling;
  if (
    next &&
    next.nodeType === Node.TEXT_NODE &&
    next.textContent?.trim() === ""
  ) {
    next.remove();
  }
  pill.remove();

  // 触发 input 事件
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function removeMention(el: HTMLElement, id: string): void {
  const pill = el.querySelector(`[${MENTION_ATTR}="${id}"]`);
  if (!pill) return;
  removeMentionElement(el, pill);
}

/**
 * 从编辑器 DOM 中提取纯文本 prompt、参考图 URL 列表与素材 assetId 列表。
 * mention pill 在 prompt 中替换为占位符 `@[name]`；assetIds 按 DOM 出现顺序去重，
 * 与后端 referenced_asset_ids（List<Long>）对齐。
 */
export function extractEditor(el: HTMLElement): {
  prompt: string;
  referenceImages: string[];
  assetIds: WireInteger[];
  mentions: ConversationMentionInput[];
} {
  const referenceImages: string[] = [];
  const assetIds: WireInteger[] = [];
  const mentions: ConversationMentionInput[] = [];
  const seenMentionIds = new Set<string>();
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as HTMLElement;
      const mentionId = elem.getAttribute(MENTION_ATTR);
      if (mentionId) {
        const mention = mentionInputOfElement(elem);
        const identity = mentionIdentity(mention);
        // 同一资源重复 pill 整个跳过（如用户复制粘贴 pill DOM）：
        // 保证 content @[name] 与有序 mentions 一一对应。
        if (identity !== null && seenMentionIds.has(identity)) {
          return;
        }
        const name = elem.getAttribute("data-mention-name") ?? mentionId;
        const src = elem.getAttribute("data-mention-src");
        parts.push(`@[${name}]`);
        if (src) referenceImages.push(src);
        if (mention && identity) {
          seenMentionIds.add(identity);
          mentions.push(mention);
          if (mention.type === "asset") {
            assetIds.push(wireInteger(mention.asset_id));
          }
        }
        return;
      }
      // 递归子节点
      for (const child of node.childNodes) {
        walk(child);
      }
    }
  };

  walk(el);

  return {
    prompt: parts.join("").replace(/ /g, " ").trim(),
    referenceImages,
    assetIds,
    mentions,
  };
}

function mentionInputOfElement(
  elem: HTMLElement,
): ConversationMentionInput | null {
  const displayName = elem.getAttribute("data-mention-name")?.trim();
  if (!displayName) return null;
  if (elem.getAttribute("data-mention-type") === "scene_card") {
    const id = elem.getAttribute("data-mention-scene-card-id");
    const version = Number(
      elem.getAttribute("data-mention-scene-card-version"),
    );
    if (
      id === null ||
      !isWireInteger(id) ||
      !Number.isSafeInteger(version) ||
      version <= 0
    ) {
      return null;
    }
    return {
      type: "scene_card",
      scene_card_id: String(wireInteger(id)),
      scene_card_version: version,
      display_name: displayName,
    };
  }
  const assetId = elem.getAttribute("data-mention-asset-id");
  if (assetId === null || !isWireInteger(assetId)) return null;
  return {
    type: "asset",
    asset_id: String(wireInteger(assetId)),
    display_name: displayName,
  };
}

function mentionIdentity(mention: ConversationMentionInput | null) {
  if (!mention) return null;
  return mention.type === "asset"
    ? `asset:${mention.asset_id}`
    : `scene_card:${mention.scene_card_id}`;
}

/** 将公开 Problem 中的失效原因投影回当前输入区；事实顺序以发送时 DOM 顺序为准。 */
export function markMentionFailures(
  el: HTMLElement,
  failures: MentionFailure[],
): void {
  const allMentionElements = Array.from(
    el.querySelectorAll<HTMLElement>(`[${MENTION_ATTR}]`),
  );
  for (const pill of allMentionElements) {
    if (pill.getAttribute("data-mention-availability") !== "unavailable") {
      continue;
    }
    pill.removeAttribute("data-mention-availability");
    pill.removeAttribute("data-mention-reason");
    pill.removeAttribute("title");
    pill.style.removeProperty("outline");
    pill.style.color = "var(--tc-text-secondary)";
    pill.querySelector("[data-mention-remove]")?.remove();
  }

  const seen = new Set<string>();
  const mentionElements = allMentionElements.filter((element) => {
    const identity = mentionIdentity(mentionInputOfElement(element));
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });

  for (const failure of failures) {
    const pill = mentionElements[failure.index];
    const mention = pill ? mentionInputOfElement(pill) : null;
    if (!pill || mention?.type !== failure.type) continue;
    pill.setAttribute("data-mention-availability", "unavailable");
    pill.setAttribute("data-mention-reason", failure.reason);
    pill.setAttribute("title", failure.reason);
    pill.style.outline = "1px solid var(--tc-destructive)";
    pill.style.color = "var(--tc-destructive)";
    if (pill.querySelector("[data-mention-remove]")) continue;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("data-mention-remove", "true");
    remove.setAttribute("aria-label", `移除失效引用 ${mention.display_name}`);
    remove.style.cssText = [
      "border:0",
      "background:transparent",
      "color:var(--tc-destructive)",
      "cursor:pointer",
      "padding:0 1px",
      "line-height:1",
    ].join(";");
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeMentionElement(el, pill);
    });
    pill.appendChild(remove);
  }
}

// ---- helpers ----

export function buildPill(item: MentionItem): HTMLElement {
  const pill = document.createElement("span");
  pill.setAttribute(MENTION_ATTR, item.id);
  pill.setAttribute("data-mention-name", item.name);
  if (item.src) pill.setAttribute("data-mention-src", item.src);
  if (item.assetId != null)
    pill.setAttribute("data-mention-asset-id", String(item.assetId));
  if (item.sceneCardId != null)
    pill.setAttribute("data-mention-scene-card-id", String(item.sceneCardId));
  if (item.sceneCardVersion != null)
    pill.setAttribute(
      "data-mention-scene-card-version",
      String(item.sceneCardVersion),
    );
  pill.setAttribute("contenteditable", "false");
  pill.setAttribute("data-mention-type", item.type);
  pill.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:3px",
    "padding:1px 6px 1px 4px",
    "margin:0 2px",
    "border-radius:6px",
    "background:var(--tc-border)",
    "color:var(--tc-text-secondary)",
    "font-size:13px",
    "line-height:20px",
    "vertical-align:middle",
    "user-select:none",
    "cursor:default",
  ].join(";");

  // 缩略图（如果有 src）
  if (item.src) {
    const img = document.createElement("img");
    img.src = item.src;
    img.alt = item.name;
    img.style.cssText = [
      "width:18px",
      "height:18px",
      "border-radius:3px",
      "object-fit:cover",
      "flex-shrink:0",
    ].join(";");
    pill.appendChild(img);
  } else {
    // 图标占位
    const icon = document.createElement("span");
    icon.textContent =
      item.type === "image"
        ? "🖼"
        : item.type === "video"
          ? "🎬"
          : item.type === "scene_card"
            ? "🗂"
            : "🎵";
    icon.style.cssText = "font-size:12px;line-height:1;";
    pill.appendChild(icon);
  }

  const label = document.createElement("span");
  label.textContent =
    item.name.length > 12 ? item.name.slice(0, 12) + "…" : item.name;
  pill.appendChild(label);

  return pill;
}
