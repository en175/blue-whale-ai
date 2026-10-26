import { useEffect } from 'react';
import { ImageMentionChip } from '../ImageMentionChip';
import { VideoMentionChip } from '../VideoMentionChip';
import { ensureAssetUrls, lookupAssetUrl, useAssetUrlCache } from './assetUrlCache';
import styles from './index.module.css';

export function AssetMentionChip({
  assetId,
  label,
  name,
  mediaType,
  url,
}: {
  assetId: string;
  label: string;
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
