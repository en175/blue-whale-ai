import type { SessionContentBlock } from '@/custom/api/agentSessions';

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

export function isCanvasNodeVideo(block: SessionContentBlock): boolean {
  if (block.media_type !== 'video' && block.type !== 'video') return false;
  if (block.source === 'node') return true;
  return block.resource_kind === '视频' || block.resource_type === '视频';
}

const CARD_SOURCES = new Set(['card-image', 'card-ref', 'card-generation', 'card-voice']);
const CARD_KINDS = new Set(['商品卡', '风格卡', '角色卡', '物体卡', '环境卡', '自定义卡', '生成卡']);

export function isCardSourcedVideo(block: SessionContentBlock): boolean {
  if (block.media_type !== 'video' && block.type !== 'video') return false;
  if (block.source && CARD_SOURCES.has(block.source)) return true;
  const kind = block.resource_kind || block.resource_type;
  return Boolean(kind && CARD_KINDS.has(kind));
}

export function isSidebarUploadedVideo(block: SessionContentBlock): boolean {
  if (block.media_type !== 'video' && block.type !== 'video') return false;
  if (!block.asset_id) return false;
  if (isCanvasNodeVideo(block) || isCardSourcedVideo(block)) return false;
  return true;
}

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
