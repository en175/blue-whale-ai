import { X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { AssetRecord } from '@/api/assets';
import Modal from '@/components/Modal';
import Skeleton from '@/components/Skeleton';
import { formatFileSize } from '@/utils/format-file-size';
import { remoteImageCrossOrigin } from '@/utils/remoteImageCors';
import { assetAspectRatio } from '../../assetGrid';
import AudioPlayer from '../AudioPlayer';
import {
  EMPTY_ASSET_DETAIL,
  formatAssetCreatedAt,
  formatAssetResolution,
  formatAssetSource,
} from './format';
import styles from './index.module.css';

interface AssetDetailModalProps {
  asset: AssetRecord | null;
  loading?: boolean;
  onClose: () => void;
}

function DetailValue({ loading, children }: { loading: boolean; children: ReactNode }) {
  return <dd>{loading ? <Skeleton className={styles.detailSkeleton} /> : children}</dd>;
}

function AssetPreview({ asset }: { asset: AssetRecord }) {
  const [loaded, setLoaded] = useState(false);
  const previewAspectRatio = assetAspectRatio(asset);
  const [ratioWidth, ratioHeight] = previewAspectRatio.split('/').map(Number);
  const previewMaxWidth = `${560 * (ratioWidth / ratioHeight)}px`;

  const previewFrameStyle = {
    aspectRatio: previewAspectRatio,
    maxWidth: previewMaxWidth,
  };

  if (!asset.url) {
    return <div className={styles.previewEmpty}>媒体文件不可用</div>;
  }

  if (asset.type === 'image' || asset.type === 'character') {
    return (
      <div
        className={`${styles.previewFrame} ${styles.imagePreviewFrame}`}
        style={previewFrameStyle}
      >
        {!loaded && <Skeleton className={styles.previewSkeleton} />}
        <img
          className={`${styles.previewMedia} ${styles.imagePreview} ${loaded ? '' : styles.previewMediaLoading}`}
          src={asset.url}
          crossOrigin={remoteImageCrossOrigin(asset.url)}
          alt="资产预览"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      </div>
    );
  }

  if (asset.type === 'video') {
    return (
      <div className={styles.previewFrame} style={previewFrameStyle}>
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
      {!loaded && <Skeleton className={styles.audioSkeleton} />}
      <AudioPlayer
        className={`${styles.audioPlayer} ${loaded ? '' : styles.previewMediaLoading}`}
        src={asset.url}
        onLoadedMetadata={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  );
}

export default function AssetDetailModal({ asset, loading = false, onClose }: AssetDetailModalProps) {
  return (
    <Modal
      open={asset !== null}
      width={960}
      footer={null}
      closable={false}
      onCancel={onClose}
      ariaLabel="资产详情"
      classNames={{
        body: styles.modalBody,
      }}
      styles={{
        container: { padding: 0 },
      }}
    >
      {asset && (
        <div className={styles.layout}>
          <div className={styles.previewPane}>
            <AssetPreview key={String(asset.id)} asset={asset} />
          </div>

          <aside className={styles.detailsPane}>
            <div className={styles.detailsHeader}>
              <span className={styles.typeBadge}>
                {asset.type === 'image' ? '图片' : asset.type === 'video' ? '视频' : asset.type === 'audio' ? '音频' : '虚拟人像'}
              </span>
              <button className={styles.closeButton} type="button" onClick={onClose} aria-label="关闭">
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <dl className={styles.detailsList}>
              <div className={styles.detailItem}>
                <dt>来源</dt>
                <DetailValue loading={loading}>{formatAssetSource(asset.source)}</DetailValue>
              </div>
              <div className={styles.detailItem}>
                <dt>创建时间</dt>
                <DetailValue loading={loading}>{formatAssetCreatedAt(asset.created_at)}</DetailValue>
              </div>
              {asset.type !== 'audio' && (
                <div className={styles.detailItem}>
                  <dt>分辨率</dt>
                  <DetailValue loading={loading}>{formatAssetResolution(asset)}</DetailValue>
                </div>
              )}
              <div className={styles.detailItem}>
                <dt>大小</dt>
                <DetailValue loading={loading}>{formatFileSize(asset.size, EMPTY_ASSET_DETAIL)}</DetailValue>
              </div>
              <div className={styles.detailItem}>
                <dt>生成模型</dt>
                <DetailValue loading={loading}>{asset.model || EMPTY_ASSET_DETAIL}</DetailValue>
              </div>
              {/* IKFSSO/IKFTQW：无提示词的素材（上传的、视频提取出来的音频、生成时 prompt
                  为空串的）整行不渲染——不占位，也不显示「暂无数据」，免得一排空字段。 */}
              {asset.prompt && (
                <div className={styles.detailItem}>
                  <dt>提示词</dt>
                  <DetailValue loading={loading}>
                    <span className={styles.promptText}>{asset.prompt}</span>
                  </DetailValue>
                </div>
              )}
            </dl>
          </aside>
        </div>
      )}
    </Modal>
  );
}
