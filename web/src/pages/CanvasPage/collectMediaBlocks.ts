import type { SessionContentBlock } from '@/api/agentSessions';

/** 画布图集 / 参考图条目。上传完成后必须带 `assetId`，@ 提及才能发成 `asset_ref`。 */
export type CanvasGalleryRef = {
  id: string;
  src: string;
  type?: 'image' | 'video';
  assetId?: string;
  /** 派生标记：资产在 snapshot 字典中查不到（素材已被删除），保存时剥离 */
  missing?: boolean;
};

export type CollectableNode = {
  id: string;
  type?: string;
  data?: Record<string, unknown> | undefined;
};

function readAssetId(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

function galleryAssetId(item: { assetId?: unknown; asset_id?: unknown }): string | undefined {
  return readAssetId(item.assetId ?? item.asset_id);
}

/**
 * 把画布节点上的媒体收成会话内容块，供 Agent 输入框 @ 提及发送。
 *
 * 图集条目若带着资产库身份，块上必须留下 `asset_id`：发送时才能走 `asset_ref`，
 * 用户气泡和对话历史才能按同一份身份还原缩略图（IKBCV3）。
 */
export function collectMediaBlocks(node: CollectableNode, chipId: string): SessionContentBlock[] {
  const blocks: SessionContentBlock[] = [];
  const d = node.data ?? {};

  // IKDLQJ：textNode 与生成卡正文不再经这里进对话——正文统一走「对话引用快照」（quoteConversation.ts），
  // 这里只继续收集显式挂在节点/卡上的媒体引用。

  if (node.type === 'mediaNode') {
    const src = d.src as string | undefined;
    if (src) {
      const mediaType = (d.mediaType as 'image' | 'video' | 'audio') ?? 'image';
      const displayLabel = (d.fileName as string) || (mediaType === 'image' ? '图片' : mediaType === 'video' ? '视频' : '音频');
      const resourceTypeMap = { image: '图片', video: '视频', audio: '音频' } as const;
      blocks.push({
        type: mediaType,
        url: src,
        mime: d.mime as string | undefined,
        duration: d.duration as number | undefined,
        name: displayLabel,
        node_id: node.id,
        asset_id: readAssetId(d.assetId ?? d.asset_id),
        source: 'node',
        resource_type: resourceTypeMap[mediaType],
        chip_id: chipId,
        resource_id: node.id,
        media_type: mediaType,
        display_label: displayLabel,
      });
    }
  }

  if (node.type === 'productNode') {
    const images = d.images as
      | { id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string; asset_id?: string }[]
      | undefined;
    const detail = (d.detail as string) ?? '';
    if (images) {
      for (const img of images) {
        if (!img.enabled || !img.src) continue;
        const mediaType = img.type ?? 'image';
        const displayLabel = mediaType === 'image' ? '商品图' : '商品视频';
        const assetId = galleryAssetId(img);
        blocks.push({
          type: mediaType,
          url: img.src,
          name: displayLabel,
          node_id: node.id,
          source: 'card-image',
          resource_type: '商品卡',
          chip_id: chipId,
          resource_id: node.id,
          media_type: mediaType,
          display_label: displayLabel,
          resource_text: detail || undefined,
          ...(assetId ? { asset_id: assetId } : {}),
        });
      }
    }
  }

  if (node.type === 'assetNode') {
    const kind = (d.kind as string) ?? 'custom';
    const resourceType =
      kind === 'style' ? '风格卡' :
      kind === 'character' ? '角色卡' :
      kind === 'object' ? '物体卡' :
      kind === 'environment' ? '环境卡' :
      kind === 'generation' ? '生成卡' :
      '自定义卡';

    if (kind === 'generation') {
      const gc = d.generationCard as {
        shotTitle?: string;
        visual?: string;
        prompt?: string;
        timeRange?: string;
        durationSeconds?: number;
        aspectRatio?: string;
        targetMedia?: 'image' | 'video';
        shotNo?: number;
        cardId?: string;
        assetRefItems?: { assetId: string; label: string; mediaType: 'image' | 'video' }[];
      } | undefined;

      if (gc) {
        // IKDLQJ：不再把旧 revision 指针（cardId/shotNo）当引用内容发出去；
        // 卡的当前提示词由「对话引用快照」捕获发送，这里只保留显式挂载的素材引用。
        if (gc.assetRefItems && gc.assetRefItems.length > 0) {
          for (const ref of gc.assetRefItems) {
            blocks.push({
              type: ref.mediaType,
              name: ref.label || '素材',
              node_id: node.id,
              asset_id: ref.assetId,
              source: 'card-ref',
              resource_type: '生成卡',
              chip_id: chipId,
              resource_id: node.id,
              media_type: ref.mediaType,
              display_label: ref.label || '素材',
            });
          }
        }
      }
    }

    const refs = (d.refs ?? d.initialRefs) as
      | { id: string; src: string; type?: 'image' | 'video'; assetId?: string; asset_id?: string }[]
      | undefined;
    if (refs && refs.length > 0) {
      for (const ref of refs) {
        if (!ref.src) continue;
        const mediaType = ref.type ?? 'image';
        const displayLabel = mediaType === 'image' ? '参考图' : '参考视频';
        const assetId = galleryAssetId(ref);
        blocks.push({
          type: mediaType,
          url: ref.src,
          name: displayLabel,
          node_id: node.id,
          source: 'card-ref',
          resource_type: resourceType,
          chip_id: chipId,
          resource_id: node.id,
          media_type: mediaType,
          display_label: displayLabel,
          ...(assetId ? { asset_id: assetId } : {}),
        });
      }
    }

    const voice = d.voice as { name: string; src: string } | undefined;
    if (voice?.src) {
      const displayLabel = voice.name || '音色';
      blocks.push({
        type: 'audio',
        url: voice.src,
        name: displayLabel,
        node_id: node.id,
        source: 'card-voice',
        resource_type: resourceType,
        chip_id: chipId,
        resource_id: node.id,
        media_type: 'audio',
        display_label: displayLabel,
      });
    }
  }

  return blocks;
}
