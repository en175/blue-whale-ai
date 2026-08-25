/* ============================================
 * AssetDetailModal 资产详情弹窗：媒体预览 + 可读字段
 * （数据以 JSON 结构携带，但展示给用户的是可读信息，不渲染原始 JSON）
 * ============================================ */
import { useMemo } from 'react';
import type { AssetRecord, AssetType } from '@/api/assets';
import { AssetMedia } from '@/components/AssetMedia';
import { sourceLabel, formatDuration, formatSize, formatDate } from './format';
import styles from './index.module.css';

const typeLabel: Record<AssetType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

interface AssetDetailModalProps {
  asset: AssetRecord | null;
  onClose: () => void;
}

export default function AssetDetailModal({ asset, onClose }: AssetDetailModalProps) {
  const rows = useMemo(() => {
    if (!asset) return [];
    return [
      { label: '类型', value: typeLabel[asset.type] ?? asset.type },
      { label: '来源', value: sourceLabel(asset.source) },
      {
        label: '尺寸',
        value:
          asset.width != null && asset.height != null
            ? `${asset.width} × ${asset.height} px`
            : '—',
      },
      {
        label: '时长',
        value:
          asset.type === 'audio' || asset.type === 'video'
            ? formatDuration(asset.duration)
            : '—',
      },
      { label: '创建时间', value: formatDate(asset.created_at) },
      { label: '文件大小', value: formatSize(asset.size) },
      { label: '生成模型', value: asset.model || '—' },
    ];
  }, [asset]);

  if (!asset) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h3 className={styles.title}>资产详情</h3>
          <button className={styles.closeBtn} onClick={onClose} title="关闭" aria-label="关闭">
            ✕
          </button>
        </div>

        <div className={styles.preview}>
          {asset.url ? (
            <AssetMedia asset={asset} />
          ) : (
            <div className={styles.previewEmpty}>资源不可用</div>
          )}
        </div>

        <dl className={styles.fields}>
          {rows.map((r) => (
            <div key={r.label} className={styles.fieldRow}>
              <dt className={styles.fieldLabel}>{r.label}</dt>
              <dd className={styles.fieldValue}>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
