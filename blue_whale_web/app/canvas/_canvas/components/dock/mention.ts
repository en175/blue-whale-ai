/**
 * Mention pill —— contentEditable 内嵌的参考图引用（对齐 topview tc-mention-pill）。
 *
 * 把参考图作为 `contenteditable=false` 的胶囊 span 插入输入框文字流，跟提示词混排；
 * 提交时从 DOM 抽取 prompt（纯文本，排除 pill）+ referenceImages（pill src 列表，按出现顺序）。
 *
 * editor 是 uncontrolled contentEditable（React 不控 innerHTML），pill 用 DOM API 插入，
 * React 重渲染不丢内容（DOM 由浏览器管）。
 */

export type MentionItem = {
  src: string;
  name: string;
  /** data-mention-id，用于去重 / 标识 */
  id: string;
};

export const PILL_ATTR = "data-mention-src";
const PILL_CLASS = "tc-mention-pill";

/** 触发 editor 的 input 事件，让 onInput（handleInput）重新抽取 prompt + mentions。 */
function dispatchInput(editor: HTMLElement) {
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

/** 建一个 mention pill DOM 节点（contenteditable=false，前图后名 + X 删除）。 */
function buildPill(item: MentionItem): HTMLElement {
  const pill = document.createElement("span");
  pill.setAttribute("contenteditable", "false");
  pill.setAttribute(PILL_ATTR, item.src);
  pill.setAttribute("data-mention-name", item.name);
  pill.setAttribute("data-mention-id", item.id);
  pill.className = `${PILL_CLASS} ${PILL_CLASS}--media`;
  pill.contentEditable = "false";

  const thumb = document.createElement("img");
  thumb.className = `${PILL_CLASS}__thumb`;
  thumb.src = item.src;
  thumb.alt = item.name;
  thumb.draggable = false;
  thumb.width = 18;
  thumb.height = 18;
  thumb.referrerPolicy = "no-referrer";
  thumb.decoding = "async";

  const name = document.createElement("span");
  name.className = `${PILL_CLASS}__name`;
  name.textContent = item.name;

  const x = document.createElement("button");
  x.type = "button";
  x.className = `${PILL_CLASS}__x`;
  x.setAttribute("aria-label", `移除 ${item.name}`);
  x.addEventListener("click", (e) => {
    e.preventDefault();
    const editor = pill.parentElement;
    pill.remove();
    if (editor) dispatchInput(editor);
  });
  x.textContent = "×";

  pill.appendChild(thumb);
  pill.appendChild(name);
  pill.appendChild(x);
  return pill;
}

/** 按素材 id 删除 mention pill；顶部缩略图删除时用于同步取消输入框引用。 */
export function removeMention(editor: HTMLDivElement, id: string): boolean {
  const pill = Array.from(editor.querySelectorAll<HTMLElement>(`[${PILL_ATTR}]`)).find(
    (node) => node.dataset.mentionId === id,
  );
  if (!pill) return false;
  pill.remove();
  dispatchInput(editor);
  return true;
}

/**
 * 在 contentEditable 光标处插入 mention pill + 后随不间断空格（保证光标可移出 pill）。
 * Range 插入模式参考 AgentChatPanel.insertSkillIntoComposer。
 */
export function insertMention(
  editor: HTMLDivElement,
  item: MentionItem,
  options?: { replace?: boolean }
) {
  editor.focus();
  if (options?.replace) {
    editor.innerHTML = "";
  } else if (editor.querySelector(`[${PILL_ATTR}="${item.src}"]`)) {
    dispatchInput(editor);
    return;
  }
  const pill = buildPill(item);
  const space = document.createTextNode(" ");

  const selection = window.getSelection();
  let placed = false;
  if (!options?.replace && selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(space);
      range.insertNode(pill);
      range.setStartAfter(space);
      range.setEndAfter(space);
      selection.removeAllRanges();
      selection.addRange(range);
      placed = true;
    }
  }
  if (!placed) {
    editor.appendChild(pill);
    editor.appendChild(space);
  }
  dispatchInput(editor);
}

/**
 * 从 editor DOM 抽取：prompt（纯文本，排除 pill）+ referenceImages（pill src 列表，按 DOM 出现顺序）。
 */
export function extractEditor(editor: HTMLDivElement): { prompt: string; referenceImages: string[] } {
  const clone = editor.cloneNode(true) as HTMLDivElement;
  clone.querySelectorAll(`[${PILL_ATTR}]`).forEach((n) => n.remove());
  const prompt = (clone.innerText ?? "").replace(/ /g, " ");
  const referenceImages: string[] = [];
  editor.querySelectorAll(`[${PILL_ATTR}]`).forEach((n) => {
    const src = (n as HTMLElement).getAttribute(PILL_ATTR);
    if (src && !referenceImages.includes(src)) referenceImages.push(src);
  });
  return { prompt, referenceImages };
}
