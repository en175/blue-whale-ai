import type { PromptMention, PromptMaterial } from '@lib/contracts/prompt-preview';
import { parseMarkdownBlocks, renderMarkdownInline } from '@lib/contracts/text-node-markdown';
import { deriveMediaMentionLabels, deriveMediaMentionLabelsInOrder, type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import chipStyles from '../mediaChip.module.css';
import textNodeStyles from './index.module.css';

/* IKFM3L 统一文本卡正文契约 v1：正文是受限 Markdown 源（data.text），
   mention 区间 [start,end) 锚定 Markdown 源字符串下标（契约 §3）。
   IKFM3Q 正文媒体索引契约 v1：media 标签共用区间模型；chip 的编号与失效样式
   全部由身份与有效性派生（契约 §2/§3），序列化把派生标签文本写回源切片。
   渲染：Markdown 源 → 白名单 HTML，标签区间用占位符遮罩后替换为 chip；
   序列化：编辑器 DOM → Markdown 源 + 区间，chip 身份独立于 DOM 位置。 */

/** 标签占位符：正文渲染期间临时替代 mention 区间，不参与格式配对 */
const MENTION_PLACEHOLDER = '￼';

interface MentionChipPart {
  assetId: string;
  index: number;
  label: string;
}

/** media 标签 chip 的身份：nodeId+assetId 显式绑定（契约 §1）；name/url 是展示快照 */
interface MediaChipIdentity {
  nodeId: string;
  assetId: string;
  mediaType: MediaRef['mediaType'];
  name: string;
  url: string;
}

/** @ 菜单/重绑定选中后创建 media 标签 chip（编号与失效样式按当时有效性派生）。 */
export function createMediaMentionChip(identity: MediaChipIdentity, label: string, invalid: boolean): HTMLElement {
  return buildMediaChip(identity, label, invalid);
}

type ChipQueueItem =
  | { kind: 'prompt'; part: MentionChipPart }
  | { kind: 'media'; part: MediaChipIdentity };

/** 正文素材标签 chip 类：胶囊视觉与生成面板共用 mediaChip.module.css（IKG7NH），
 *  文本卡差异（整块选中）叠加 mediaChipSelectable，失效态叠加 mediaChipInvalid。 */
const MEDIA_CHIP_CLASS = `${chipStyles.mediaChip} ${textNodeStyles.mediaChipSelectable}`;
const MEDIA_CHIP_INVALID_CLASS = `${MEDIA_CHIP_CLASS} ${chipStyles.mediaChipInvalid}`;

/** 写入 chip 的可变展示（编号/失效文本 + 失效类）；thumb 与身份 dataset 在建 chip 时固定。 */
function applyMediaChipVisual(chip: HTMLElement, label: string, invalid: boolean) {
  chip.dataset.mediaLabel = label;
  if (invalid) chip.dataset.mediaInvalid = '1';
  else delete chip.dataset.mediaInvalid;
  chip.className = invalid ? MEDIA_CHIP_INVALID_CLASS : MEDIA_CHIP_CLASS;
  chip.title = invalid ? `已失效：${chip.dataset.mediaName ?? ''}` : `${chip.dataset.mediaName ?? ''}（${label}）`;
  chip.setAttribute('aria-label', chip.title);
  const thumb = chip.querySelector<HTMLElement>('[data-media-thumb]');
  if (thumb) thumb.style.display = invalid ? 'none' : '';
  const labelEl = chip.querySelector<HTMLElement>('[data-media-label-text]');
  if (labelEl) labelEl.textContent = label;
}

/** media 标签 chip：身份 dataset + 缩略图；展示经 applyMediaChipVisual 派生。 */
function buildMediaChip(identity: MediaChipIdentity, label: string, invalid: boolean): HTMLElement {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.mediaNode = identity.nodeId;
  chip.dataset.mediaAsset = identity.assetId;
  chip.dataset.mediaType = identity.mediaType;
  chip.dataset.mediaName = identity.name;
  chip.dataset.mediaUrl = identity.url;
  const thumb = document.createElement('span');
  thumb.dataset.mediaThumb = '1';
  thumb.className = chipStyles.mediaChipThumbWrap;
  if (identity.mediaType === 'audio') {
    const icon = document.createElement('span');
    icon.textContent = '♫';
    icon.setAttribute('aria-hidden', 'true');
    icon.className = chipStyles.mediaChipAudioIcon;
    thumb.append(icon);
  } else if (/^https?:\/\//.test(identity.url)) {
    const media = document.createElement(identity.mediaType === 'image' ? 'img' : 'video');
    media.src = identity.url;
    media.className = chipStyles.mediaChipThumb;
    if (media instanceof HTMLImageElement) media.alt = '';
    else { media.preload = 'metadata'; media.muted = true; }
    thumb.append(media);
  }
  chip.append(thumb);
  const labelEl = document.createElement('span');
  labelEl.dataset.mediaLabelText = '1';
  labelEl.className = chipStyles.mediaChipLabel;
  chip.append(labelEl);
  applyMediaChipVisual(chip, label, invalid);
  return chip;
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
  chip.className = MEDIA_CHIP_CLASS;
  const material = materials.find(item => item.assetId === part.assetId);
  if (material?.mediaType === 'audio') {
    const icon = document.createElement('span');
    icon.textContent = '♫';
    icon.setAttribute('aria-hidden', 'true');
    icon.className = chipStyles.mediaChipAudioIcon;
    chip.append(icon);
  } else if (material && /^https?:\/\//.test(material.url)) {
    const media = document.createElement(material.mediaType === 'image' ? 'img' : 'video');
    media.src = material.url;
    media.className = chipStyles.mediaChipThumb;
    if (media instanceof HTMLImageElement) media.alt = '';
    else { media.preload = 'metadata'; media.muted = true; }
    chip.append(media);
  }
  const labelEl = document.createElement('span');
  labelEl.className = chipStyles.mediaChipLabel;
  labelEl.textContent = `#${part.index}`;
  chip.append(labelEl);
  return chip;
}

/** 行内片段（含软换行）→ HTML；软换行渲染为 br。 */
function inlineHtml(text: string): string {
  return text.split('\n').map(renderMarkdownInline).join('<br>');
}

/** 把行内 HTML 装载为节点，占位符按出现顺序从 chip 队列消费替换。 */
function mountInlineHtml(html: string, chips: ChipQueueItem[], materials: Array<PromptMaterial & { url: string }>, mediaParts: Map<string, { label: string; invalid: boolean }>): DocumentFragment {
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
        const item = chips.shift();
        let replacement: ChildNode = document.createTextNode('');
        if (item?.kind === 'prompt') replacement = buildMentionChip(item.part, materials);
        else if (item?.kind === 'media') {
          const state = mediaParts.get(item.part.nodeId) ?? { label: item.part.name, invalid: true };
          replacement = buildMediaChip(item.part, state.label, state.invalid);
        }
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

/** 渲染统一正文：Markdown 源 + prompt/media 区间 → 编辑器 DOM（含 chip）。
 *  media chip 的编号与失效样式由 deriveMediaMentionLabels 派生（契约 §2/§3），不信任源切片文本。 */
export function renderPromptMentions(
  editor: HTMLElement,
  markdown: string,
  mentions: PromptMention[],
  materials: Array<PromptMaterial & { url: string }>,
  mediaMentions: MediaMention[] = [],
  mediaRefs: MediaRef[] = [],
  isValid: (nodeId: string) => boolean = () => false,
) {
  editor.replaceChildren();
  // IKG99G：应用到的生成卡同时携带 promptMentions 与 mediaMentions（同区间），
  // 渲染去重——promptMention 覆盖的区间不再渲染 media chip，保留方案 #N 身份；
  // mediaMentions 仅作画布内部接线（供 textIndexOfTarget 消费），不重复展示，
  // 避免图片后跟一个"已失效/图片N"多余标签
  const promptRanges = new Set(mentions.map(m => `${m.start}-${m.end}`));
  const combined = [
    ...mentions.map(mention => ({ kind: 'prompt' as const, start: mention.start, end: mention.end, mention })),
    ...mediaMentions.filter(mention => !promptRanges.has(`${mention.start}-${mention.end}`))
      .map(mention => ({ kind: 'media' as const, start: mention.start, end: mention.end, mention })),
  ].sort((a, b) => a.start - b.start);
  const refByNode = new Map(mediaRefs.map(ref => [ref.nodeId, ref]));
  const labels = deriveMediaMentionLabels(mediaMentions, mediaRefs, isValid);
  const mediaParts = new Map<string, { label: string; invalid: boolean }>();
  for (const mention of mediaMentions) {
    if (mediaParts.has(mention.nodeId)) continue;
    const ref = refByNode.get(mention.nodeId);
    mediaParts.set(mention.nodeId, {
      label: labels.get(mention.nodeId) ?? (ref?.name ?? mention.nodeId),
      invalid: !isValid(mention.nodeId),
    });
  }
  // 占位符遮罩 mention 区间；第 k 个占位符对应第 k 个有序区间
  let masked = '';
  let cursor = 0;
  for (const item of combined) {
    masked += markdown.slice(cursor, item.start) + MENTION_PLACEHOLDER;
    cursor = item.end;
  }
  masked += markdown.slice(cursor);
  const chips: ChipQueueItem[] = combined.map(item => item.kind === 'prompt'
    ? { kind: 'prompt', part: { assetId: item.mention.assetId, index: item.mention.index, label: markdown.slice(item.start, item.end) } }
    : {
      kind: 'media',
      part: {
        nodeId: item.mention.nodeId,
        assetId: item.mention.assetId,
        mediaType: refByNode.get(item.mention.nodeId)?.mediaType ?? 'image',
        name: refByNode.get(item.mention.nodeId)?.name ?? item.mention.nodeId,
        url: refByNode.get(item.mention.nodeId)?.url ?? '',
      },
    });

  const blocks = parseMarkdownBlocks(masked);
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.kind === 'list-item') {
      const isOrdered = block.ordered === true;
      const list = document.createElement(isOrdered ? 'ol' : 'ul');
      while (index < blocks.length && blocks[index].kind === 'list-item' && blocks[index].ordered === isOrdered) {
        const item = document.createElement('li');
        item.append(mountInlineHtml(inlineHtml(blocks[index].lines.join('\n')), chips, materials, mediaParts));
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
      heading.append(mountInlineHtml(inlineHtml(block.lines[0] ?? ''), chips, materials, mediaParts));
      editor.append(heading);
      continue;
    }
    const paragraph = document.createElement('p');
    paragraph.append(mountInlineHtml(inlineHtml(block.lines.join('\n')), chips, materials, mediaParts));
    editor.append(paragraph);
  }
}

/** 从 chip DOM 读取身份（序列化与就地刷新共用；dataset 是 chip 的唯一身份载体）。 */
function readChipIdentity(chip: HTMLElement): MediaChipIdentity {
  return {
    nodeId: chip.dataset.mediaNode ?? '',
    assetId: chip.dataset.mediaAsset ?? '',
    mediaType: (chip.dataset.mediaType ?? 'image') as MediaRef['mediaType'],
    name: chip.dataset.mediaName ?? '',
    url: chip.dataset.mediaUrl ?? '',
  };
}

/** 编辑中就地刷新 media chip 的编号与失效样式（连线/来源变化不重建 DOM，保住光标）。 */
export function applyMediaMentionState(editor: HTMLElement, isValid: (nodeId: string) => boolean) {
  const chips = [...editor.querySelectorAll<HTMLElement>('[data-media-node]')];
  if (chips.length === 0) return;
  const identities = chips.map(readChipIdentity);
  const refs = dedupeMediaRefs(identities);
  const labels = deriveMediaMentionLabelsInOrder(identities, refs, isValid);
  for (const chip of chips) {
    const nodeId = chip.dataset.mediaNode ?? '';
    applyMediaChipVisual(chip, labels.get(nodeId) ?? (chip.dataset.mediaName ?? nodeId), !isValid(nodeId));
  }
}

/** 序列化期 mention 草稿：chip 以占位符进入 Markdown 流，最终区间锚定规范化后的字符串 */
type DraftMention =
  | { kind: 'prompt'; label: string; assetId: string; index: number }
  | { kind: 'media'; identity: MediaChipIdentity };

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
    result.mentions.push({ kind: 'prompt', label: node.dataset.promptLabel ?? '', assetId: node.dataset.promptAsset, index: Number(node.dataset.promptIndex) });
    return;
  }
  if (node instanceof HTMLElement && node.dataset.mediaNode) {
    result.markdown += MENTION_PLACEHOLDER;
    result.mentions.push({ kind: 'media', identity: readChipIdentity(node) });
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

/** 顶层行内容器（裸文本节点/chip/BR 合并为同一段落）：flush 为段落块并复位。 */
function flushInline(out: DomBlock[], pending: InlineResult) {
  if (pending.markdown.trim() !== '' || pending.mentions.length > 0) {
    out.push({ kind: 'paragraph', inline: { markdown: pending.markdown, mentions: pending.mentions } });
  }
  pending.markdown = '';
  pending.mentions = [];
}

/** 把编辑器顶层节点解析为块序列。裸文本节点/chip/BR 属行内内容，并入 pending 段落（契约 §3 原子 chip 不拆段）。 */
function collectDomBlocks(node: Node, listOrdered: boolean | null, out: DomBlock[], pending: InlineResult) {
  if (node.nodeType === Node.TEXT_NODE) {
    if ((node.textContent ?? '').trim() === '') return;
    pending.markdown += node.textContent ?? '';
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.dataset.promptAsset || node.dataset.mediaNode) { serializeInline(node, pending); return; }
  if (node.tagName === 'BR') { pending.markdown += '\n'; return; }
  flushInline(out, pending);
  const tag = node.tagName;
  if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
    out.push({ kind: 'heading', level: Number(tag[1]), inline: serializeBlock(node) });
    return;
  }
  if (tag === 'HR') { out.push({ kind: 'rule', inline: { markdown: '', mentions: [] } }); return; }
  if (tag === 'UL' || tag === 'OL') {
    const listPending: InlineResult = { markdown: '', mentions: [] };
    node.childNodes.forEach(child => collectDomBlocks(child, tag === 'OL', out, listPending));
    flushInline(out, listPending);
    return;
  }
  if (tag === 'LI') {
    const nested: DomBlock[] = [];
    node.childNodes.forEach(child => {
      if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) {
        const nestedPending: InlineResult = { markdown: '', mentions: [] };
        collectDomBlocks(child, null, nested, nestedPending);
        flushInline(nested, nestedPending);
      }
    });
    out.push({ kind: 'list-item', ordered: listOrdered === true, inline: serializeBlock(node), nested: nested.length ? nested : undefined });
    return;
  }
  // p/div 及其他容器：整块序列化，嵌套块级子元素随行内压平（execCommand 混合产物）
  if (tag === 'P' || tag === 'DIV') {
    const hasBlockChild = Array.from(node.children).some(child => /^(H[1-3]|UL|OL|HR|LI|P|DIV)$/.test(child.tagName));
    if (hasBlockChild) { node.childNodes.forEach(child => collectDomBlocks(child, null, out, { markdown: '', mentions: [] })); return; }
  }
  out.push({ kind: 'paragraph', inline: serializeBlock(node) });
}

/** media 身份按出现顺序去重为 refs 快照（契约 §1：精确覆盖由后端校验兜底）。 */
function dedupeMediaRefs(identities: MediaChipIdentity[]): MediaRef[] {
  const seen = new Set<string>();
  const refs: MediaRef[] = [];
  for (const identity of identities) {
    if (seen.has(identity.nodeId)) continue;
    seen.add(identity.nodeId);
    refs.push({ nodeId: identity.nodeId, assetId: identity.assetId, mediaType: identity.mediaType, name: identity.name, url: identity.url });
  }
  return refs;
}

/** Serialize tag identities independently from their current DOM position.
 *  media 标签文本写回派生标签（有效=类型+编号，失效=已失效：name），区间锚定规范化后的 Markdown 源。 */
export function readPromptMentions(
  editor: HTMLElement,
  isValid: (nodeId: string) => boolean = () => false,
): { text: string; mentions: PromptMention[]; mediaMentions: MediaMention[]; mediaRefs: MediaRef[] } {
  const blocks: DomBlock[] = [];
  const topPending: InlineResult = { markdown: '', mentions: [] };
  editor.childNodes.forEach(node => collectDomBlocks(node, null, blocks, topPending));
  flushInline(blocks, topPending);
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
  // media 标签文本由契约派生（编号/失效），不信任 chip 的 DOM 残留文本
  const mediaDrafts = drafts.filter((draft): draft is Extract<DraftMention, { kind: 'media' }> => draft.kind === 'media');
  const mediaRefs = dedupeMediaRefs(mediaDrafts.map(draft => draft.identity));
  const mediaLabels = deriveMediaMentionLabelsInOrder(mediaDrafts.map(draft => draft.identity), mediaRefs, isValid);
  const mentions: PromptMention[] = [];
  const mediaMentions: MediaMention[] = [];
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
    if (draft.kind === 'prompt') {
      text += draft.label;
      mentions.push({ start, end: text.length, assetId: draft.assetId, index: draft.index });
    } else {
      const label = mediaLabels.get(draft.identity.nodeId) ?? draft.identity.name;
      text += label;
      mediaMentions.push({ start, end: text.length, nodeId: draft.identity.nodeId, assetId: draft.identity.assetId });
    }
    cursor = index + 1;
  }
  text += normalized.slice(cursor);
  return { text, mentions, mediaMentions, mediaRefs };
}
