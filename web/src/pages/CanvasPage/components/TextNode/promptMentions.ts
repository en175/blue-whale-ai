import type { PromptMention, PromptMaterial } from '@lib/contracts/prompt-preview';
import { parseMarkdownBlocks, renderMarkdownInline } from '@lib/contracts/text-node-markdown';

/* IKFM3L 统一文本卡正文契约 v1：正文是受限 Markdown 源（data.text），
   mention 区间 [start,end) 锚定 Markdown 源字符串下标（契约 §3）。
   渲染：Markdown 源 → 白名单 HTML，标签区间用占位符遮罩后替换为 chip；
   序列化：编辑器 DOM → Markdown 源 + 区间，chip 身份独立于 DOM 位置。 */

/** 标签占位符：正文渲染期间临时替代 mention 区间，不参与格式配对 */
const MENTION_PLACEHOLDER = '￼';

interface MentionChipPart {
  assetId: string;
  index: number;
  label: string;
}

/** Construct tags from trusted identity metadata; never inject source HTML. */
function buildMentionChip(part: MentionChipPart, materials: Array<PromptMaterial & { url: string }>): HTMLElement {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.promptAsset = part.assetId;
  chip.dataset.promptIndex = String(part.index);
  chip.dataset.promptLabel = part.label;
  chip.title = `${part.label}（素材 #${part.index}）`;
  chip.setAttribute('aria-label', chip.title);
  chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 5px;border:1px solid #555;border-radius:5px;background:#303030;vertical-align:middle;user-select:all';
  const material = materials.find(item => item.assetId === part.assetId);
  if (material?.mediaType === 'audio') {
    const icon = document.createElement('span');
    icon.textContent = '♫';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.cssText = 'width:24px;text-align:center';
    chip.append(icon);
  } else if (material && /^https?:\/\//.test(material.url)) {
    const media = document.createElement(material.mediaType === 'image' ? 'img' : 'video');
    media.src = material.url;
    media.style.cssText = 'width:24px;height:24px;object-fit:cover;pointer-events:none';
    if (media instanceof HTMLImageElement) media.alt = '';
    else { media.preload = 'metadata'; media.muted = true; }
    chip.append(media);
  }
  chip.append(document.createTextNode(`#${part.index}`));
  return chip;
}

/** 行内片段（含软换行）→ HTML；软换行渲染为 br。 */
function inlineHtml(text: string): string {
  return text.split('\n').map(renderMarkdownInline).join('<br>');
}

/** 把行内 HTML 装载为节点，占位符按出现顺序从 chip 队列消费替换。 */
function mountInlineHtml(html: string, chips: MentionChipPart[], materials: Array<PromptMaterial & { url: string }>): DocumentFragment {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const pending: Array<{ parent: ParentNode; node: Text }> = [];
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent ?? '').includes(MENTION_PLACEHOLDER)) pending.push({ parent: node.parentNode!, node: node as Text });
  }
  for (const { parent, node } of pending) {
    const segments = (node.textContent ?? '').split(MENTION_PLACEHOLDER);
    const anchor = document.createTextNode('');
    parent.replaceChild(anchor, node);
    let cursor: ChildNode = anchor;
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i] !== '') {
        const text = document.createTextNode(segments[i]);
        cursor.after(text);
        cursor = text;
      }
      if (i < segments.length - 1) {
        const part = chips.shift();
        const replacement = part ? buildMentionChip(part, materials) : document.createTextNode('');
        cursor.after(replacement);
        cursor = replacement;
      }
    }
    anchor.remove();
  }
  const fragment = document.createDocumentFragment();
  fragment.append(...holder.childNodes);
  return fragment;
}

/** 渲染统一正文：Markdown 源 + mention 区间 → 编辑器 DOM（含 chip）。 */
export function renderPromptMentions(editor: HTMLElement, markdown: string, mentions: PromptMention[], materials: Array<PromptMaterial & { url: string }>) {
  editor.replaceChildren();
  const ordered = [...mentions].sort((a, b) => a.start - b.start);
  // 占位符遮罩 mention 区间；第 k 个占位符对应第 k 个有序 mention
  let masked = '';
  let cursor = 0;
  for (const mention of ordered) {
    masked += markdown.slice(cursor, mention.start) + MENTION_PLACEHOLDER;
    cursor = mention.end;
  }
  masked += markdown.slice(cursor);
  const chips: MentionChipPart[] = ordered.map(mention => ({
    assetId: mention.assetId,
    index: mention.index,
    label: markdown.slice(mention.start, mention.end),
  }));

  const blocks = parseMarkdownBlocks(masked);
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.kind === 'list-item') {
      const isOrdered = block.ordered === true;
      const list = document.createElement(isOrdered ? 'ol' : 'ul');
      while (index < blocks.length && blocks[index].kind === 'list-item' && blocks[index].ordered === isOrdered) {
        const item = document.createElement('li');
        item.append(mountInlineHtml(inlineHtml(blocks[index].lines.join('\n')), chips, materials));
        list.append(item);
        index += 1;
      }
      editor.append(list);
      continue;
    }
    index += 1;
    if (block.kind === 'rule') { editor.append(document.createElement('hr')); continue; }
    if (block.kind === 'heading') {
      const heading = document.createElement(`h${block.level ?? 1}`);
      heading.append(mountInlineHtml(inlineHtml(block.lines[0] ?? ''), chips, materials));
      editor.append(heading);
      continue;
    }
    const paragraph = document.createElement('p');
    paragraph.append(mountInlineHtml(inlineHtml(block.lines.join('\n')), chips, materials));
    editor.append(paragraph);
  }
}

/** 序列化期 mention 草稿：chip 以占位符进入 Markdown 流，最终区间锚定规范化后的字符串 */
interface DraftMention {
  label: string;
  assetId: string;
  index: number;
}

/** 行内序列化产物：Markdown 片段（chip 以占位符表示）+ 草稿序列 */
interface InlineResult {
  markdown: string;
  mentions: DraftMention[];
}

/** 递归序列化行内节点：粗/斜体产出标记，chip 产出占位符并入草稿，BR 产出软换行。 */
function serializeInline(node: Node, result: InlineResult) {
  if (node.nodeType === Node.TEXT_NODE) {
    result.markdown += node.textContent ?? '';
    return;
  }
  if (node instanceof HTMLElement && node.dataset.promptAsset) {
    result.markdown += MENTION_PLACEHOLDER;
    result.mentions.push({ label: node.dataset.promptLabel ?? '', assetId: node.dataset.promptAsset, index: Number(node.dataset.promptIndex) });
    return;
  }
  if (node instanceof HTMLElement && node.tagName === 'BR') {
    result.markdown += '\n';
    return;
  }
  const marker = node instanceof HTMLElement && (node.tagName === 'B' || node.tagName === 'STRONG') ? '**'
    : node instanceof HTMLElement && (node.tagName === 'I' || node.tagName === 'EM') ? '*' : '';
  if (marker) result.markdown += marker;
  node.childNodes.forEach(child => serializeInline(child, result));
  if (marker) result.markdown += marker;
}

/** 序列化块级容器（p、div、h1–h3、li）的整段行内内容。 */
function serializeBlock(node: HTMLElement): InlineResult {
  const result: InlineResult = { markdown: '', mentions: [] };
  node.childNodes.forEach(child => {
    // li 内嵌套列表压平为后续列表块
    if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) return;
    serializeInline(child, result);
  });
  return result;
}

interface DomBlock {
  kind: 'heading' | 'paragraph' | 'list-item' | 'rule';
  level?: number;
  ordered?: boolean;
  inline: InlineResult;
  /** 嵌套列表：压平追加到当前块之后 */
  nested?: DomBlock[];
}

/** 把编辑器顶层节点解析为块序列。 */
function collectDomBlocks(node: Node, listOrdered: boolean | null, out: DomBlock[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    if ((node.textContent ?? '').trim() === '') return;
    out.push({ kind: 'paragraph', inline: { markdown: node.textContent ?? '', mentions: [] } });
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const tag = node.tagName;
  if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
    out.push({ kind: 'heading', level: Number(tag[1]), inline: serializeBlock(node) });
    return;
  }
  if (tag === 'HR') { out.push({ kind: 'rule', inline: { markdown: '', mentions: [] } }); return; }
  if (tag === 'UL' || tag === 'OL') {
    node.childNodes.forEach(child => collectDomBlocks(child, tag === 'OL', out));
    return;
  }
  if (tag === 'LI') {
    const nested: DomBlock[] = [];
    node.childNodes.forEach(child => {
      if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) collectDomBlocks(child, null, nested);
    });
    out.push({ kind: 'list-item', ordered: listOrdered === true, inline: serializeBlock(node), nested: nested.length ? nested : undefined });
    return;
  }
  // p/div 及其他容器：整块序列化，嵌套块级子元素随行内压平（execCommand 混合产物）
  if (tag === 'P' || tag === 'DIV') {
    const hasBlockChild = Array.from(node.children).some(child => /^(H[1-3]|UL|OL|HR|LI|P|DIV)$/.test(child.tagName));
    if (hasBlockChild) { node.childNodes.forEach(child => collectDomBlocks(child, null, out)); return; }
  }
  out.push({ kind: 'paragraph', inline: serializeBlock(node) });
}

/** Serialize tag identities independently from their current DOM position. */
export function readPromptMentions(editor: HTMLElement): { text: string; mentions: PromptMention[] } {
  const blocks: DomBlock[] = [];
  editor.childNodes.forEach(node => collectDomBlocks(node, null, blocks));
  // 展开 li 嵌套列表
  const flat: DomBlock[] = [];
  const flatten = (list: DomBlock[]) => {
    for (const block of list) {
      flat.push(block);
      if (block.nested) flatten(block.nested);
    }
  };
  flatten(blocks);

  const parts: string[] = [];
  const drafts: DraftMention[] = [];
  let orderedCounter = 0;
  let previous: DomBlock | null = null;
  for (const block of flat) {
    const hasContent = block.inline.markdown.trim() !== '' || block.inline.mentions.length > 0;
    if (!hasContent && block.kind !== 'rule') { previous = block; continue; }
    let separator = previous === null ? '' : '\n\n';
    let prefix = '';
    if (block.kind === 'heading') prefix = `${'#'.repeat(block.level ?? 1)} `;
    else if (block.kind === 'rule') prefix = '---';
    else if (block.kind === 'list-item') {
      if (previous?.kind === 'list-item' && previous.ordered === block.ordered) separator = '\n';
      if (block.ordered) { orderedCounter += 1; prefix = `${orderedCounter}. `; }
      else prefix = '- ';
    }
    if (block.kind !== 'list-item') orderedCounter = 0;
    drafts.push(...block.inline.mentions);
    parts.push(separator + prefix + block.inline.markdown);
    previous = block;
  }
  // 先规范化（折叠多余换行、去首尾空白），再把占位符按出现顺序替换回标签文本：
  // mention 区间锚定规范化后的最终字符串，避免折叠/trim 造成区间偏移（契约 §3）
  const normalized = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  const mentions: PromptMention[] = [];
  let text = '';
  let cursor = 0;
  let next = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== MENTION_PLACEHOLDER) continue;
    const draft = drafts[next];
    next += 1;
    if (!draft) continue;
    text += normalized.slice(cursor, index);
    const start = text.length;
    text += draft.label;
    mentions.push({ start, end: text.length, assetId: draft.assetId, index: draft.index });
    cursor = index + 1;
  }
  text += normalized.slice(cursor);
  return { text, mentions };
}
