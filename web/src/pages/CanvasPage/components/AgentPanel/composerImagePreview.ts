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
