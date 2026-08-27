import type { SessionContentBlock } from '@/api/agentSessions';

export interface ComposerImagePreview {
  url: string;
  label: string;
}

function isImageBlock(block: SessionContentBlock): boolean {
  return block.media_type === 'image' || block.type === 'image';
}

/**
 * 画布独立图片节点 @ 进输入框时，用原图做胶囊，而不是 `[图片]` 纯文字。
 *
 * 只认 `source: 'node'` 的图片：视频、商品卡、图集、生成卡仍走原来的 `@` 文字胶囊。
 */
export function composerImagePreview(
  blocks: SessionContentBlock[] | undefined,
): ComposerImagePreview | undefined {
  const image = (blocks ?? []).find((block) => isImageBlock(block) && block.source === 'node' && Boolean(block.url));
  if (!image?.url) return undefined;
  return {
    url: image.url,
    label: image.display_label || image.name || '图片',
  };
}
