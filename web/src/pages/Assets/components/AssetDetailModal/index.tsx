import { AudioLines } from 'lucide-react';
import { useState } from 'react';
import type { AssetRecord } from '@/api/assets';
import Modal from '@/components/Modal';
import Skeleton from '@/components/Skeleton';
import { formatFileSize } from '@/utils/format-file-size';
import {
  EMPTY_ASSET_DETAIL,
  formatAssetCreatedAt,
  formatAssetResolution,
  formatAssetSource,
} from './format';
import styles from './index.module.css';

interface AssetDetailModalProps {
  asset: AssetRecord | null;
  onClose: () => void;
}

function AssetPreview({ asset }: { asset: AssetRecord }) {
  const [loaded, setLoaded] = useState(false);
  const previewAspectRatio = asset.width && asset.height ? asset.width / asset.height : 1;

  if (!asset.url) {
    return <div className={styles.previewEmpty}>媒体文件不可用</div>;
  }

  if (asset.type === 'image') {
    return (
      <div
        className={`${styles.previewFrame} ${styles.imagePreviewFrame}`}
        style={{ aspectRatio: previewAspectRatio }}
      >
        {!loaded && <Skeleton className={styles.previewSkeleton} />}
        <img
          className={`${styles.previewMedia} ${styles.imagePreview} ${loaded ? '' : styles.previewMediaLoading}`}
          src={asset.url}
          alt="资产预览"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      </div>
    );
  }

  if (asset.type === 'video') {
    return (
      <div className={styles.previewFrame}>
        {!loaded && <Skeleton className={styles.previewSkeleton} />}
        <video
          className={`${styles.previewMedia} ${loaded ? '' : styles.previewMediaLoading}`}
          src={asset.url}
          controls
          playsInline
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      </div>
    );
  }

  return (
    <div className={styles.audioPreview}>
      <div className={styles.audioIcon}>
        <AudioLines size={44} strokeWidth={1.5} />
      </div>
      {!loaded && <Skeleton className={styles.audioSkeleton} />}
      <audio
        className={`${styles.audioPlayer} ${loaded ? '' : styles.previewMediaLoading}`}
        src={asset.url}
        controls
        preload="metadata"
        onLoadedMetadata={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  );
}

export default function AssetDetailModal({ asset, onClose }: AssetDetailModalProps) {
  return (
    <Modal
      open={asset !== null}
      title="资产详情"
      width={960}
      footer={null}
      onCancel={onClose}
      classNames={{
        container: styles.modal,
        body: styles.modalBody,
      }}
    >
      {asset && (
        <div className={styles.layout}>
          <div className={styles.previewPane}>
            <AssetPreview key={String(asset.id)} asset={asset} />
          </div>

          <aside className={styles.detailsPane}>
            <span className={styles.typeBadge}>
              {asset.type === 'image' ? '图片' : asset.type === 'video' ? '视频' : '音频'}
            </span>
            <dl className={styles.detailsList}>
              <div className={styles.detailItem}>
                <dt>来源</dt>
                <dd>{formatAssetSource(asset.source)}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>创建时间</dt>
                <dd>{formatAssetCreatedAt(asset.created_at)}</dd>
              </div>
              {asset.type !== 'audio' && (
                <div className={styles.detailItem}>
                  <dt>分辨率</dt>
                  <dd>{formatAssetResolution(asset)}</dd>
                </div>
              )}
              <div className={styles.detailItem}>
                <dt>大小</dt>
                <dd>{formatFileSize(asset.size, EMPTY_ASSET_DETAIL)}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>生成模型</dt>
                <dd>{asset.model || EMPTY_ASSET_DETAIL}</dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </Modal>
  );
}
