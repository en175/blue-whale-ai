import type { SessionContentBlock } from '@/api/agentSessions';
import type { ChatMessage } from '../../hooks/useAgentSession';
import type { Turn } from '../../hooks/sessionTimeline';

/**
 * 助手正文里的素材名 → 素材胶囊（IKDLW3）。
 *
 * 对话面此前只在两处画素材胶囊：用户消息里的素材引用，和生成卡里的素材引用。助手正文走纯
 * Markdown，模型提到用户上传的那张图（「231e92…jpg」「_smoke.jpg」）时只是一串文字，和上面两处
 * 的形态对不上。这里把本会话**已知**的素材展示名在正文里找出来，交给同一种胶囊去画。
 *
 * 已知素材从哪来：本会话用户消息里的 `asset_ref` / 图片 / 视频部件——`asset_id` + `display_label`
 * + `media_type`，前端手里本来就有，不需要新接口。URL 不在这里：`asset_ref` 按契约只带身份，
 * 胶囊组件自己按 id 反查（见 MessageAssetPreview 的缓存）。
 *
 * 匹配规则：整名匹配，名字两侧不能紧贴 ASCII 字母数字（`_smoke.jpg` 不匹配 `my_smoke.jpg2`）；
 * 同一段里出现几次画几次；名字互为前缀时长的优先。流式正文自然安全：半截名字不匹配就还是字，
 * 打到完整那一刻才换成胶囊。
 */
export interface KnownAsset {
  assetId: string;
  label: string;
  mediaType: 'image' | 'video';
  /** 胶囊上显示的字，不给就是 label。生成卡正文按 `@图1` 认、胶囊上写「图1」时用。 */
  display?: string | undefined;
  /** 悬停时看到的素材全名，不给就是胶囊上的字。 */
  name?: string | undefined;
  /** 上传当轮本地带着的 URL；历史消息没有，由胶囊按 id 反查。 */
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
  // 没有名字就没有可匹配的东西；太短的名字（「图」）会把正文里的普通字也变成胶囊。
  if (label.length < 3) return null;
  return { assetId: String(block.asset_id), label, mediaType, url: block.url || undefined };
}

/** 从整段对话的用户消息里收集已知素材；同一个 asset_id 只留一份，名字长的排前面。 */
export function collectKnownAssets(turns: readonly Turn[]): KnownAsset[] {
  const byId = new Map<string, KnownAsset>();
  const messages: ChatMessage[] = turns.flatMap((turn) => turn.user);
  for (const message of messages) {
    for (const block of [...(message.blocks ?? []), ...(message.resource_ref ?? [])]) {
      const asset = assetOf(block);
      if (!asset) continue;
      const seen = byId.get(asset.assetId);
      // 后来的一条带 URL 而先前的没有时补上；名字以第一次出现的为准。
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

/**
 * 把一段纯文本按素材名切开：字符串原样保留，命中的名字换成 `{ asset }`。
 * `assets` 须已按名字长度降序（`collectKnownAssets` 的输出就是）。
 */
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

/* -------------------------------------------------------------------------- */
/* rehype 插件：在 Markdown 语法树上做同一件事                                   */
/* -------------------------------------------------------------------------- */

/**
 * hast 节点的最小结构。不引 `@types/hast`：它只是 react-markdown 的传递依赖，直接 import 在 pnpm
 * 严格模式下随时会断；这里用到的字段就这几个。
 */
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

/** 胶囊在树上的形态：一个带 data 属性的 span，渲染时由 Markdown 组件的 `span` 覆写认出来。 */
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

/** 围栏代码块和链接里的字不动：一个是代码，一个已经是别的东西。 */
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
      // 模型习惯把文件名包在反引号里（`_smoke.jpg`）。整个行内代码就是一个素材名时，把代码
      // 元素整个换成胶囊；带别的字的行内代码照旧。
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

/** react-markdown 的 `rehypePlugins` 用法：`rehypeAssetMentions(assets)`。没有已知素材时是空操作。 */
export function rehypeAssetMentions(assets: readonly KnownAsset[]) {
  return () => (tree: HastNode) => {
    if (assets.length === 0) return;
    transform(tree, assets);
  };
}
