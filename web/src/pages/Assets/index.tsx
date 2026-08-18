/* ============================================
 * Assets 资产页面：GET /api/assets 全量拉取 + 类型筛选 + 真实媒体预览
 * ============================================ */

import { useEffect, useRef, useState } from 'react';
import { Upload, Play, Trash2 } from 'lucide-react';
import { fetchAllAssets, deleteAsset, UPLOAD_SIZE_LIMIT, type AssetRecord, type AssetType } from '@/api/assets';
import { isApiError } from '@/api/http';
import { uploadAssetFile, fileToAssetType } from '@/utils/upload';
import ConfirmModal from '@/components/ConfirmModal';
import styles from './index.module.css';

/** 筛选类型：all 表示不传 type */
type FilterKey = 'all' | AssetType;

/** 筛选按钮定义 */
const filterTabs: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
];

/** 类型标签文字 */
const typeLabel: Record<AssetType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

export default function Assets() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AssetRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 筛选切换时全量拉取（size=60，按 total 自动分页）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    fetchAllAssets(activeFilter === 'all' ? '' : activeFilter)
      .then((list) => {
        if (alive) setAssets(list);
      })
      .catch((e) => {
        if (alive) setLoadError(isApiError(e) ? e.message : '资产列表加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFilter]);

  /** 上传素材：presign 获取预签名 URL → PUT 直传对象存储（complete 登记接口待联调） */
  const handleUpload = () => {
    if (!uploading) fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || uploading) return;
    const list = Array.from(files);
    // 先清空 input 以支持重复上传同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';

    setUploading(true);
    setActionError('');
    const errors: string[] = [];

    for (const file of list) {
      const type = fileToAssetType(file);
      if (!type) {
        errors.push(`不支持的文件类型：${file.name}`);
        continue;
      }
      const limitMb = Math.round(UPLOAD_SIZE_LIMIT[type] / 1024 / 1024);
      if (file.size > UPLOAD_SIZE_LIMIT[type]) {
        errors.push(`${file.name} 超过 ${limitMb}MB 上限`);
        continue;
      }
      try {
        // presign → PUT 直传 → complete 登记（共享工具）
        const done = await uploadAssetFile(file);
        // 登记成功：新资产插入列表顶部（url 为空时降级本地预览）
        setAssets((prev) => [
          {
            id: done.asset_id,
            type: done.type,
            url: done.url || URL.createObjectURL(file),
            width: done.width || null,
            height: done.height || null,
            duration: done.duration,
            source: 'uploaded',
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      } catch (err) {
        errors.push(isApiError(err) ? `${file.name}：${err.message}` : `上传失败：${file.name}`);
      }
    }

    if (errors.length) setActionError(errors.join('；'));
    setUploading(false);
  };

  // 列表即接口全量数据（上传登记后顶部插入）
  const displayAssets = assets;

  /** 确认删除：DELETE /api/assets/:assetId，成功后从列表移除该项 */
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setActionError('');
    try {
      await deleteAsset(deleteTarget.id);
      setAssets((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '删除失败，请稍后重试');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* 顶部标题栏 */}
        <div className={styles.header}>
          <h1 className={styles.pageTitle}>资产库</h1>
          <div className={styles.headerActions}>
            {/* 筛选按钮 */}
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                className={`${styles.filterBtn} ${activeFilter === tab.key ? styles.filterBtnActive : ''}`}
                onClick={() => setActiveFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}

            {/* 分隔线 */}
            <div className={styles.divider} />

            {/* 上传按钮 */}
            <button className={styles.uploadBtn} onClick={handleUpload} disabled={uploading}>
              <Upload size={16} strokeWidth={2} />
              <span>{uploading ? '上传中…' : '上传素材'}</span>
            </button>
            {actionError && <span className={styles.actionError}>{actionError}</span>}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              className={styles.hiddenInput}
              onChange={handleFileChange}
            />
          </div>
        </div>

        {/* 资产网格（2-5 列自适应） */}
        <div className={styles.grid}>
          {loading && <div className={styles.empty}>加载中…</div>}
          {!loading && loadError && <div className={styles.empty}>{loadError}</div>}
          {!loading && !loadError && displayAssets.length === 0 && (
            <div className={styles.empty}>暂无资产，点击"上传素材"添加</div>
          )}

          {!loading &&
            !loadError &&
            displayAssets.map((asset) => (
              <div key={String(asset.id)} className={styles.card}>
                {/* 预览区域：image→img，video→video，audio→audio */}
                <div className={styles.thumbnail}>
                  {asset.type === 'image' && asset.url && (
                    <img className={styles.media} src={asset.url} alt="" loading="lazy" />
                  )}
                  {asset.type === 'video' && asset.url && (
                    <>
                      <video
                        className={styles.media}
                        src={asset.url}
                        muted
                        playsInline
                        preload="metadata"
                      />
                      <div className={styles.playIcon}>
                        <Play size={24} fill="#fff" strokeWidth={0} />
                      </div>
                    </>
                  )}
                  {asset.type === 'audio' && asset.url && (
                    <audio
                      className={styles.audioPlayer}
                      src={asset.url}
                      controls
                      preload="metadata"
                    />
                  )}
                  {/* 类型标签 */}
                  <span className={styles.typeBadge}>{typeLabel[asset.type]}</span>
                  {/* 右上角删除按钮 */}
                  <button
                    className={styles.deleteBtn}
                    title="删除资产"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(asset);
                    }}
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={!!deleteTarget}
        title="删除资产"
        message={
          deleteTarget
            ? `确定要删除该${typeLabel[deleteTarget.type]}资产吗？此操作不可撤销。`
            : ''
        }
        confirmText="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
