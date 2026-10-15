import { useEffect, useState } from 'react';
import type { SessionContentBlock } from '@/custom/api/agentSessions';
import { ImageMentionChip } from '../ImageMentionChip';
import { VideoMentionChip } from '../VideoMentionChip';
import { isCanvasNodeVideo, isSidebarUploadedVideo } from './composerImagePreview';
import { ensureAssetUrls, lookupAssetUrl } from './assetUrlCache';
import styles from './index.module.css';

export function MessageAssetPreview({
  blocks,
  chips,
}: {
  blocks: SessionContentBlock[] | undefined;
  chips?: { id: string }[];
}) {
  const refs = (blocks ?? []).flatMap((block, index) => {
    const mediaType = block.media_type === 'video' || block.type === 'video' ? 'video'
      : block.media_type === 'image' || block.type === 'image' ? 'image'
      : null;
    if (!mediaType) return [];
    const mentionIds = [block.chip_id, block.asset_id, block.resource_id, block.node_id];
    const nodeVideo = mediaType === 'video' && isCanvasNodeVideo(block);
    const sidebarUpload = mediaType === 'video' && isSidebarUploadedVideo(block);
    const assetId = block.asset_id;
    const url = block.url || lookupAssetUrl(assetId);
    if (mediaType === 'video' && !nodeVideo && !sidebarUpload && chips?.some((chip) => mentionIds.includes(chip.id))) return [];
    if (mediaType === 'image' && !url && !assetId) return [];
    if (nodeVideo && !url && !assetId) return [];
    return [{
      key: assetId || block.resource_id || block.node_id || `image-${index}`,
      assetId,
      url,
      mediaType,
      nodeVideo,
      sidebarUpload,
      label: block.display_label || block.name || (mediaType === 'video' ? '视频' : '图片'),
    }];
  });
  const unresolvedAssetIds = refs.filter((ref) => !ref.url && ref.assetId).map((ref) => ref.assetId!);
  const unresolvedAssetKey = unresolvedAssetIds.join(',');
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!unresolvedAssetKey) return;
    let alive = true;
    void ensureAssetUrls(unresolvedAssetKey.split(',').filter(Boolean)).then(() => {
      if (alive) forceRender((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [unresolvedAssetKey]);

  if (refs.length === 0) return null;

  return (
    <div className={styles.messageAssets}>
      {refs.map((ref) => {
        if (ref.mediaType === 'video') {
          if (ref.url && (ref.nodeVideo || ref.sidebarUpload)) {
            return <VideoMentionChip key={ref.key} url={ref.url} label={ref.label} />;
          }
          if (ref.nodeVideo) {
            return (
              <span key={ref.key} className={styles.messageAssetFallback} title={ref.label}>
                视频：{ref.label}
              </span>
            );
          }
          return null;
        }
        if (ref.url) {
          return <ImageMentionChip key={ref.key} url={ref.url} label={ref.label} />;
        }
        return (
          <span key={ref.key} className={styles.messageAssetFallback} title={ref.label}>
            图片：{ref.label}
          </span>
        );
      })}
    </div>
  );
}
