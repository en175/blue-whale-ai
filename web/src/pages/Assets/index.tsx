/* ============================================
 * Assets 资产页面：GET /api/assets 全量拉取 + 类型筛选 + 真实媒体预览
 * ============================================ */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Upload, Play, Trash2, RotateCw, AlertCircle, Loader2 } from 'lucide-react';
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

/** 媒体加载状态 */
type MediaLoadState = 'waiting' | 'loading' | 'loaded' | 'error';

/** 单个资产媒体组件：统一处理 loading / loaded / error 三态 */
function AssetMedia({ asset }: { asset: AssetRecord }) {
  const isSafari = isSafariBrowser();
  // Safari 视频初始为 waiting（懒加载），其余直接进入 loading
  const [state, setState] = useState<MediaLoadState>(
    asset.type === 'video' && isSafari ? 'waiting' : 'loading',
  );
  const [reloadKey, setReloadKey] = useState(0);

  // URL 或 reloadKey 变化时重置为 loading（视频通过 VideoThumb 的 onLoaded/onError 驱动状态）
  useEffect(() => {
    if (asset.type !== 'video') {
      setState('loading');
    }
  }, [asset.url, reloadKey, asset.type]);

  const handleReload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setReloadKey((k) => k + 1);
    // Safari 视频重试需回到 waiting 让 IntersectionObserver 重新触发；其余直接 loading
    if (asset.type === 'video' && isSafari) {
      setState('waiting');
    } else {
      setState('loading');
    }
  }, [asset.type, isSafari]);

  const mediaSrc = `${asset.url}${asset.url.includes('?') ? '&' : '?'}_reload=${reloadKey}`;

  return (
    <>
      {/* loading 遮罩（图片/音频） */}
      {state === 'loading' && (
        <div className={styles.mediaLoading}>
          <Loader2 size={24} className={styles.spinner} />
        </div>
      )}

      {/* waiting 遮罩（视频未进入视口）：显示半透明背景，无 spinner，减轻视觉负担 */}
      {state === 'waiting' && (
        <div className={styles.mediaLoading} style={{ opacity: 0.3 }}>
          <Loader2 size={24} className={styles.spinner} />
        </div>
      )}

      {/* error 遮罩 + 重试按钮 */}
      {state === 'error' && (
        <div className={styles.mediaError}>
          <AlertCircle size={28} />
          <span className={styles.mediaErrorText}>加载失败</span>
          <button className={styles.mediaRetryBtn} onClick={handleReload} title="重新加载">
            <RotateCw size={14} />
            <span>点击重试</span>
          </button>
        </div>
      )}

      {/* 实际媒体元素 */}
      {asset.type === 'image' && asset.url && (
        <img
          className={styles.media}
          src={mediaSrc}
          alt=""
          loading="lazy"
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      {asset.type === 'video' && asset.url && (
        <VideoThumb
          url={mediaSrc}
          onInView={() => setState('loading')}
          onLoaded={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      {asset.type === 'audio' && asset.url && (
        <audio
          className={styles.audioPlayer}
          src={mediaSrc}
          controls
          preload="metadata"
          onLoadedData={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
    </>
  );
}

/** 检测是否为 Safari 浏览器（不包含 Chrome/Chromium/Edge 等基于 Safari 的浏览器） */
function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Safari 的特征：包含 Safari 但不包含 Chrome/Chromium/Edge/OPR
  return /^((?!chrome|android|edge|opr|crios).)*safari/i.test(ua);
}

/** 视频缩略图：Safari 下使用 IntersectionObserver 懒加载（避免并发请求超时），其他浏览器直接加载保持原有体验 */
function VideoThumb({
  url,
  onLoaded,
  onError,
  onInView,
}: {
  url: string;
  onLoaded?: () => void;
  onError?: () => void;
  onInView?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const useLazy = isSafariBrowser();

  // Safari 下：IntersectionObserver 懒加载，视频进入视口才请求
  useEffect(() => {
    if (!useLazy) {
      // 非 Safari：直接加载，跳过 IO 检测，通知父组件切换到 loading 态
      setInView(true);
      onInView?.();
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          onInView?.();
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [useLazy, onInView]);

  // 关键修复：检测缓存视频的 readyState，避免 onLoadedData 事件因竞态丢失
  // 当视频从浏览器缓存加载时，loadeddata 事件可能在 React 合成事件绑定之前就已触发
  useEffect(() => {
    if (!inView) return;
    const video = videoRef.current;
    if (!video) return;

    const checkReady = () => {
      // readyState >= 2 表示 HAVE_CURRENT_DATA（首帧已就绪）
      if (video.readyState >= 2) {
        onLoaded?.();
      }
    };

    // 立即检查（处理缓存场景，事件可能已触发过）
    checkReady();

    // 同时绑定原生事件监听作为兜底
    video.addEventListener('loadeddata', checkReady);
    return () => video.removeEventListener('loadeddata', checkReady);
  }, [inView, onLoaded]);

  const startPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    void video.play().catch(() => setPlaying(false));
  };

  return (
    <>
      <div ref={containerRef} className={styles.videoContainer}>
        <video
          ref={videoRef}
          className={styles.media}
          src={inView ? url : undefined}
          muted
          playsInline
          preload="metadata"
          controls={playing}
          onLoadedData={() => onLoaded?.()}
          onError={() => onError?.()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onClick={() => {
            if (!playing) startPlay();
          }}
        />
      </div>
      {!playing && inView && (
        <button type="button" className={styles.playIcon} title="播放视频" onClick={startPlay}>
          <Play size={22} fill="#fff" strokeWidth={0} />
        </button>
      )}
    </>
  );
}

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
                {/* 预览区域：AssetMedia 统一处理 loading/loaded/error 三态 */}
                <div className={styles.thumbnail}>
                  {asset.url ? (
                    <AssetMedia asset={asset} />
                  ) : (
                    <div className={styles.mediaError}>
                      <AlertCircle size={28} />
                      <span className={styles.mediaErrorText}>资源不可用</span>
                    </div>
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
