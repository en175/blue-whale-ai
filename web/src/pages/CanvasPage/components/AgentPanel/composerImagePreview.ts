import type { SessionContentBlock } from '@/api/agentSessions';

export interface ComposerMediaPreview {
  url: string;
  label: string;
  mediaType: 'image' | 'video';
}

export type ComposerImagePreview = ComposerMediaPreview;

function isNodeImage(block: SessionContentBlock): boolean {
  return (block.media_type === 'image' || block.type === 'image') && block.source === 'node' && Boolean(block.url);
}

function isNodeVideo(block: SessionContentBlock): boolean {
  return (block.media_type === 'video' || block.type === 'video') && block.source === 'node' && Boolean(block.url);
}

/**
 * 历史快照会把画布视频块写成 `resource_ref` / `asset_ref`，`source` 可能还在，
 * 也可能只剩下 round-trip 的 `resource_kind: 视频`。
 */
export function isCanvasNodeVideo(block: SessionContentBlock): boolean {
  if (block.media_type !== 'video' && block.type !== 'video') return false;
  if (block.source === 'node') return true;
  return block.resource_kind === '视频' || block.resource_type === '视频';
}

const CARD_SOURCES = new Set(['card-image', 'card-ref', 'card-generation', 'card-voice']);
const CARD_KINDS = new Set(['商品卡', '风格卡', '角色卡', '物体卡', '环境卡', '自定义卡', '生成卡']);

/** 商品卡 / 图集 / 生成卡上的视频：气泡里继续走 `@ [视频]` 文字胶囊（IKCHEC / IKCJFQ）。 */
export function isCardSourcedVideo(block: SessionContentBlock): boolean {
  if (block.media_type !== 'video' && block.type !== 'video') return false;
  if (block.source && CARD_SOURCES.has(block.source)) return true;
  const kind = block.resource_kind || block.resource_type;
  return Boolean(kind && CARD_KINDS.has(kind));
}

/**
 * 侧边栏「+」上传的视频：只有资产库身份，没有画布节点 / 卡片来源。
 * 刷新后历史里也是这副模样，靠它和普通 @ / 商品卡分开。
 */
export function isSidebarUploadedVideo(block: SessionContentBlock): boolean {
  if (block.media_type !== 'video' && block.type !== 'video') return false;
  if (!block.asset_id) return false;
  if (isCanvasNodeVideo(block) || isCardSourcedVideo(block)) return false;
  return true;
}

/**
 * 画布独立图片/视频节点 @ 进输入框时，用原媒体做胶囊，而不是 `[图片]` / `[视频]` 纯文字。
 *
 * 只认 `source: 'node'` 且带 URL 的图/视频：商品卡、图集、生成卡、音频仍走原来的 `@` 文字胶囊。
 */
export function composerImagePreview(
  blocks: SessionContentBlock[] | undefined,
): ComposerMediaPreview | undefined {
  const media = (blocks ?? []).find((block) => isNodeImage(block) || isNodeVideo(block));
  if (!media?.url) return undefined;
  const mediaType: 'image' | 'video' = isNodeVideo(media) ? 'video' : 'image';
  return {
    url: media.url,
    label: media.display_label || media.name || (mediaType === 'video' ? '视频' : '图片'),
    mediaType,
  };
}
