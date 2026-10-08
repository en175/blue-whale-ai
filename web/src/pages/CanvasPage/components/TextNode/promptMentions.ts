import type { PromptMention, PromptMaterial } from '@lib/contracts/prompt-preview';
import { parseMarkdownBlocks, renderMarkdownInline } from '@lib/contracts/text-node-markdown';
import { deriveMediaMentionLabels, deriveMediaMentionLabelsInOrder, type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import chipStyles from '../mediaChip.module.css';
import textNodeStyles from './index.module.css';
import { resolveMediaSrc } from '@/utils/remoteImageCors';


const MENTION_PLACEHOLDER = '￼';

interface MentionChipPart {
  assetId: string;
  index: number;
  label: string;
  mirror?: MediaChipIdentity;
}

interface MediaChipIdentity {
  nodeId: string;
  assetId: string;
  mediaType: MediaRef['mediaType'];
  name: string;
  url: string;
}

export function createMediaMentionChip(identity: MediaChipIdentity, label: string, invalid: boolean): HTMLElement {
  return buildMediaChip(identity, label, invalid);
}

type ChipQueueItem =
  | { kind: 'prompt'; part: MentionChipPart; invalid: boolean }
  | { kind: 'media'; part: MediaChipIdentity };

const MEDIA_CHIP_CLASS = `${chipStyles.mediaChip} ${textNodeStyles.mediaChipSelectable}`;
const MEDIA_CHIP_INVALID_CLASS = `${MEDIA_CHIP_CLASS} ${chipStyles.mediaChipInvalid}`;

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
    media.src = resolveMediaSrc(identity.url);
    media.className = chipStyles.mediaChipThumb;
    if (media instanceof HTMLImageElement) {
      media.alt = '';
      media.crossOrigin = 'anonymous';
    }
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

function buildMentionChip(
  part: MentionChipPart,
  materials: Array<PromptMaterial & { url: string }>,
  invalid: boolean,
): HTMLElement {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.promptAsset = part.assetId;
  chip.dataset.promptIndex = String(part.index);
  chip.dataset.promptLabel = part.label;
  if (part.mirror) {
    chip.dataset.promptMirrorNode = part.mirror.nodeId;
    chip.dataset.promptMirrorAsset = part.mirror.assetId;
    chip.dataset.promptMirrorType = part.mirror.mediaType;
    chip.dataset.promptMirrorName = part.mirror.name;
    chip.dataset.promptMirrorUrl = part.mirror.url;
    chip.dataset.mediaName = part.mirror.name;
  } else {
    chip.dataset.mediaName = part.label;
  }
  const material = materials.find(item => item.assetId === part.assetId);
  const thumb = document.createElement('span');
  thumb.dataset.mediaThumb = '1';
  thumb.className = chipStyles.mediaChipThumbWrap;
  if (material?.mediaType === 'audio') {
    const icon = document.createElement('span');
    icon.textContent = '♫';
    icon.setAttribute('aria-hidden', 'true');
    icon.className = chipStyles.mediaChipAudioIcon;
    thumb.append(icon);
  } else if (material && /^https?:\/\//.test(material.url)) {
    const media = document.createElement(material.mediaType === 'image' ? 'img' : 'video');
    media.src = resolveMediaSrc(material.url);
    media.className = chipStyles.mediaChipThumb;
    if (media instanceof HTMLImageElement) {
      media.alt = '';
      media.crossOrigin = 'anonymous';
    }
    else { media.preload = 'metadata'; media.muted = true; }
    thumb.append(media);
  }
  if (thumb.childNodes.length > 0) chip.append(thumb);
  const labelEl = document.createElement('span');
  labelEl.dataset.mediaLabelText = '1';
  labelEl.className = chipStyles.mediaChipLabel;
  chip.append(labelEl);
  const name = chip.dataset.mediaName ?? '';
  applyMediaChipVisual(chip, invalid ? `已失效：${name}` : `#${part.index}`, invalid);
  return chip;
}

function inlineHtml(text: string): string {
  return text.split('\n').map(renderMarkdownInline).join('<br>');
}

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
        if (item?.kind === 'prompt') replacement = buildMentionChip(item.part, materials, item.invalid);
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
  const promptRanges = new Set(mentions.map(m => `${m.start}-${m.end}`));
  const mirrorsByRange = new Map<string, MediaMention[]>();
  for (const mention of mediaMentions) {
    const key = `${mention.start}-${mention.end}`;
    if (!promptRanges.has(key)) continue;
    const bucket = mirrorsByRange.get(key);
    if (bucket) bucket.push(mention);
    else mirrorsByRange.set(key, [mention]);
  }
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
  let masked = '';
  let cursor = 0;
  for (const item of combined) {
    masked += markdown.slice(cursor, item.start) + MENTION_PLACEHOLDER;
    cursor = item.end;
  }
  masked += markdown.slice(cursor);
  const chips: ChipQueueItem[] = combined.map(item => {
    if (item.kind === 'prompt') {
      const covered = mirrorsByRange.get(`${item.start}-${item.end}`)?.find(m => m.assetId === item.mention.assetId);
      const ref = covered ? refByNode.get(covered.nodeId) : undefined;
      return {
        kind: 'prompt',
        invalid: Boolean(covered && !isValid(covered.nodeId)),
        part: {
          assetId: item.mention.assetId,
          index: item.mention.index,
          label: markdown.slice(item.start, item.end),
          ...(covered ? {
            mirror: {
              nodeId: covered.nodeId,
              assetId: covered.assetId,
              mediaType: ref?.mediaType ?? 'image',
              name: ref?.name ?? covered.nodeId,
              url: ref?.url ?? '',
            },
          } : {}),
        },
      };
    }
    return {
      kind: 'media',
      part: {
        nodeId: item.mention.nodeId,
        assetId: item.mention.assetId,
        mediaType: refByNode.get(item.mention.nodeId)?.mediaType ?? 'image',
        name: refByNode.get(item.mention.nodeId)?.name ?? item.mention.nodeId,
        url: refByNode.get(item.mention.nodeId)?.url ?? '',
      },
    };
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

function readChipIdentity(chip: HTMLElement): MediaChipIdentity {
  return {
    nodeId: chip.dataset.mediaNode ?? '',
    assetId: chip.dataset.mediaAsset ?? '',
    mediaType: (chip.dataset.mediaType ?? 'image') as MediaRef['mediaType'],
    name: chip.dataset.mediaName ?? '',
    url: chip.dataset.mediaUrl ?? '',
  };
}

export function applyMediaMentionState(editor: HTMLElement, isValid: (nodeId: string) => boolean) {
  const chips = [...editor.querySelectorAll<HTMLElement>('[data-media-node]')];
  if (chips.length > 0) {
    const identities = chips.map(readChipIdentity);
    const refs = dedupeMediaRefs(identities);
    const labels = deriveMediaMentionLabelsInOrder(identities, refs, isValid);
    for (const chip of chips) {
      const nodeId = chip.dataset.mediaNode ?? '';
      applyMediaChipVisual(chip, labels.get(nodeId) ?? (chip.dataset.mediaName ?? nodeId), !isValid(nodeId));
    }
  }
  for (const chip of editor.querySelectorAll<HTMLElement>('[data-prompt-mirror-node]')) {
    const nodeId = chip.dataset.promptMirrorNode ?? '';
    const name = chip.dataset.promptMirrorName || chip.dataset.mediaName || '';
    const invalid = !isValid(nodeId);
    applyMediaChipVisual(chip, invalid ? `已失效：${name}` : `#${chip.dataset.promptIndex ?? ''}`, invalid);
  }
}

type DraftMention =
  | { kind: 'prompt'; label: string; assetId: string; index: number; mirror?: MediaChipIdentity }
  | { kind: 'media'; identity: MediaChipIdentity };

interface InlineResult {
  markdown: string;
  mentions: DraftMention[];
}

function serializeInline(node: Node, result: InlineResult) {
  if (node.nodeType === Node.TEXT_NODE) {
    result.markdown += node.textContent ?? '';
    return;
  }
  if (node instanceof HTMLElement && node.dataset.promptAsset) {
    result.markdown += MENTION_PLACEHOLDER;
    const mirrorNode = node.dataset.promptMirrorNode;
    result.mentions.push({
      kind: 'prompt',
      label: node.dataset.promptLabel ?? '',
      assetId: node.dataset.promptAsset,
      index: Number(node.dataset.promptIndex),
      ...(mirrorNode ? {
        mirror: {
          nodeId: mirrorNode,
          assetId: node.dataset.promptMirrorAsset ?? '',
          mediaType: (node.dataset.promptMirrorType ?? 'image') as MediaRef['mediaType'],
          name: node.dataset.promptMirrorName ?? '',
          url: node.dataset.promptMirrorUrl ?? '',
        },
      } : {}),
    });
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

function serializeBlock(node: HTMLElement): InlineResult {
  const result: InlineResult = { markdown: '', mentions: [] };
  node.childNodes.forEach(child => {
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
  nested?: DomBlock[];
}

function flushInline(out: DomBlock[], pending: InlineResult) {
  if (pending.markdown.trim() !== '' || pending.mentions.length > 0) {
    out.push({ kind: 'paragraph', inline: { markdown: pending.markdown, mentions: pending.mentions } });
  }
  pending.markdown = '';
  pending.mentions = [];
}

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
  if (tag === 'P' || tag === 'DIV') {
    const hasBlockChild = Array.from(node.children).some(child => /^(H[1-3]|UL|OL|HR|LI|P|DIV)$/.test(child.tagName));
    if (hasBlockChild) { node.childNodes.forEach(child => collectDomBlocks(child, null, out, { markdown: '', mentions: [] })); return; }
  }
  out.push({ kind: 'paragraph', inline: serializeBlock(node) });
}

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

export function readPromptMentions(
  editor: HTMLElement,
  isValid: (nodeId: string) => boolean = () => false,
): { text: string; mentions: PromptMention[]; mediaMentions: MediaMention[]; mediaRefs: MediaRef[] } {
  const blocks: DomBlock[] = [];
  const topPending: InlineResult = { markdown: '', mentions: [] };
  editor.childNodes.forEach(node => collectDomBlocks(node, null, blocks, topPending));
  flushInline(blocks, topPending);
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
  const normalized = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  const mediaDrafts = drafts.filter((draft): draft is Extract<DraftMention, { kind: 'media' }> => draft.kind === 'media');
  const mirrorIdentities: MediaChipIdentity[] = [];
  for (const draft of drafts) {
    if (draft.kind === 'prompt' && draft.mirror) mirrorIdentities.push(draft.mirror);
  }
  const mediaRefs = dedupeMediaRefs([...mediaDrafts.map(draft => draft.identity), ...mirrorIdentities]);
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
      const end = text.length;
      mentions.push({ start, end, assetId: draft.assetId, index: draft.index });
      if (draft.mirror) mediaMentions.push({ start, end, nodeId: draft.mirror.nodeId, assetId: draft.mirror.assetId });
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
