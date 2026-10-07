import { useEffect } from 'react';
import { ImageMentionChip } from '../ImageMentionChip';
import { VideoMentionChip } from '../VideoMentionChip';
import { ensureAssetUrls, lookupAssetUrl, useAssetUrlCache } from './assetUrlCache';
import styles from './index.module.css';

/**
 * 助手正文里的素材胶囊（IKDLW3）。与用户消息里的是同一个组件（ImageMentionChip / VideoMentionChip），
 * 所以缩略图、悬浮预览长得一样。
 *
 * URL 不随消息来：`asset_ref` 只带身份。上传当轮本地缓存里有；刷新后要按 id 拉详情
 * （与 MessageAssetPreview 共用同一份缓存）。反查回来之前先画一颗只有名字的胶囊，
 * 位置不变、不闪。
 */
export function AssetMentionChip({
  assetId,
  label,
  name,
  mediaType,
  url,
}: {
  assetId: string;
  label: string;
  /** 胶囊上写的是「图1」这种号时，悬停看到的素材全名。 */
  name?: string | undefined;
  mediaType: 'image' | 'video';
  url?: string | undefined;
}) {
  useAssetUrlCache();
  const resolved = url || lookupAssetUrl(assetId);
  useEffect(() => {
    if (!resolved && assetId) void ensureAssetUrls([assetId]);
  }, [resolved, assetId]);
  if (!resolved) {
    return (
      <span className={`${styles.assetMention} ${styles.assetMentionPending}`} title={name ?? label}>
        {label}
      </span>
    );
  }
  return (
    <span className={styles.assetMention}>
      {mediaType === 'video' ? <VideoMentionChip url={resolved} label={label} title={name} /> : <ImageMentionChip url={resolved} label={label} title={name} />}
    </span>
  );
}
