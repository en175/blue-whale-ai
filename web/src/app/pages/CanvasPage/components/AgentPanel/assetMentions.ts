import type { SessionContentBlock } from '@/app/api/agentSessions';
import type { ChatMessage } from '../../hooks/useAgentSession';
import type { Turn } from '../../hooks/sessionTimeline';

export interface KnownAsset {
  assetId: string;
  label: string;
  mediaType: 'image' | 'video';
  display?: string | undefined;
  name?: string | undefined;
  url?: string | undefined;
}

function assetOf(block: SessionContentBlock): KnownAsset | null {
  const mediaType =
    block.media_type === 'video' || block.type === 'video'
      ? 'video'
      : block.media_type === 'image' || block.type === 'image'
        ? 'image'
        : null;
  if (!mediaType || !block.asset_id) return null;
  const label = (block.display_label || block.name || '').trim();
  if (label.length < 3) return null;
  return { assetId: String(block.asset_id), label, mediaType, url: block.url || undefined };
}

export function collectKnownAssets(turns: readonly Turn[]): KnownAsset[] {
  const byId = new Map<string, KnownAsset>();
  const messages: ChatMessage[] = turns.flatMap((turn) => turn.user);
  for (const message of messages) {
    for (const block of [...(message.blocks ?? []), ...(message.resource_ref ?? [])]) {
      const asset = assetOf(block);
      if (!asset) continue;
      const seen = byId.get(asset.assetId);
      if (!seen) byId.set(asset.assetId, asset);
      else if (!seen.url && asset.url) byId.set(asset.assetId, { ...seen, url: asset.url });
    }
  }
  return [...byId.values()].sort((a, b) => b.label.length - a.label.length);
}

const ASCII_WORD = /[A-Za-z0-9]/;

function boundedAt(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return !ASCII_WORD.test(before) && !ASCII_WORD.test(after);
}

export type MentionPiece = string | { asset: KnownAsset };

export function splitByAssetMentions(text: string, assets: readonly KnownAsset[]): MentionPiece[] {
  if (!text || assets.length === 0) return [text];
  const pieces: MentionPiece[] = [];
  let cursor = 0;
  let i = 0;
  while (i < text.length) {
    let hit: KnownAsset | null = null;
    for (const asset of assets) {
      if (text.startsWith(asset.label, i) && boundedAt(text, i, i + asset.label.length)) {
        hit = asset;
        break;
      }
    }
    if (!hit) {
      i += 1;
      continue;
    }
    if (i > cursor) pieces.push(text.slice(cursor, i));
    pieces.push({ asset: hit });
    i += hit.label.length;
    cursor = i;
  }
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return pieces;
}


interface HastText {
  type: 'text';
  value: string;
}
interface HastElement {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
}
interface HastOther {
  type: string;
  children?: HastNode[];
}
type HastNode = HastText | HastElement | HastOther;

export const ASSET_MENTION_ATTR = 'data-asset-mention';

function mentionElement(asset: KnownAsset): HastElement {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      [ASSET_MENTION_ATTR]: asset.assetId,
      'data-asset-label': asset.display ?? asset.label,
      'data-asset-media': asset.mediaType,
      ...(asset.name ? { 'data-asset-name': asset.name } : {}),
      ...(asset.url ? { 'data-asset-url': asset.url } : {}),
    },
    children: [{ type: 'text', value: asset.display ?? asset.label }],
  };
}

function isElement(node: HastNode): node is HastElement {
  return node.type === 'element';
}

const OPAQUE_TAGS = new Set(['pre', 'a', 'script', 'style']);

function transform(node: HastNode, assets: readonly KnownAsset[]): void {
  if (!('children' in node) || !node.children) return;
  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text') {
      const pieces = splitByAssetMentions((child as HastText).value, assets);
      if (pieces.length === 1 && typeof pieces[0] === 'string') {
        next.push(child);
        continue;
      }
      for (const piece of pieces) {
        next.push(typeof piece === 'string' ? { type: 'text', value: piece } : mentionElement(piece.asset));
      }
      continue;
    }
    if (isElement(child)) {
      if (OPAQUE_TAGS.has(child.tagName)) {
        next.push(child);
        continue;
      }
      if (child.tagName === 'code' && child.children.length === 1 && child.children[0]?.type === 'text') {
        const value = (child.children[0] as HastText).value.trim();
        const hit = assets.find((asset) => asset.label === value);
        if (hit) {
          next.push(mentionElement(hit));
          continue;
        }
        next.push(child);
        continue;
      }
      transform(child, assets);
      next.push(child);
      continue;
    }
    if ('children' in child) transform(child, assets);
    next.push(child);
  }
  node.children = next;
}

export function rehypeAssetMentions(assets: readonly KnownAsset[]) {
  return () => (tree: HastNode) => {
    if (assets.length === 0) return;
    transform(tree, assets);
  };
}
