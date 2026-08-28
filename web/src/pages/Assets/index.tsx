/* ============================================
 * Assets 资产页面：GET /api/assets 全量拉取 + 类型筛选 + 真实媒体预览
 * ============================================ */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Trash2, RotateCw, AlertCircle, Loader2, Plus } from 'lucide-react';
import { fetchAllAssets, deleteAsset, UPLOAD_SIZE_LIMIT, fetchUploadPresign, putToPresignedUrl, completeUpload, type AssetRecord, type AssetType } from '@/api/assets';
import { createAsset as createMaterialAsset } from '@/api/material';
import { uploadAssetFile } from '@/utils/upload';
import { isApiError } from '@/api/http';
import { fileToAssetType } from '@/utils/upload';
import ConfirmModal from '@/components/ConfirmModal';
import Skeleton from '@/components/Skeleton';
import AssetDetailModal from './components/AssetDetailModal';
import CharacterLibrary from './components/CharacterLibrary';
import styles from './index.module.css';

/** 筛选类型：all 表示不传 type */
type FilterKey = 'all' | AssetType;

/** 筛选按钮定义 */
const filterTabs: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'character', label: '虚拟人像库' },
];

/** 类型标签文字 */
const typeLabel: Record<AssetType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  character: '虚拟人像',
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
  const imgRef = useRef<HTMLImageElement>(null);

  const mediaSrc = `${asset.url}${asset.url.includes('?') ? '&' : '?'}_reload=${reloadKey}`;

  // URL 或 reloadKey 变化时重置为 loading（视频通过 VideoThumb 的 onLoaded/onError 驱动状态）
  useEffect(() => {
    if (asset.type !== 'video') {
      setState('loading');
    }
  }, [asset.url, reloadKey, asset.type]);

  // 缓存图片竞态兜底：load 事件可能在 onLoad 处理器就绪前已派发，
  // 此时 img.complete 为 true 但 state 仍是 loading，遮罩永远不会消失
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setState('loaded');
    }
  }, [mediaSrc]);

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
      {(asset.type === 'image' || asset.type === 'character') && asset.url && (
        <img
          ref={imgRef}
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

/** localStorage key for persisting the last selected filter tab */
const ACTIVE_FILTER_STORAGE_KEY = 'assets.activeFilter';

/** 从 localStorage 读取上次选中的 tab，无记录或非法值回退到 'all' */
const readStoredFilter = (): FilterKey => {
  if (typeof window === 'undefined') return 'all';
  try {
    const v = window.localStorage.getItem(ACTIVE_FILTER_STORAGE_KEY);
    if (v && filterTabs.some((t) => t.key === v)) return v as FilterKey;
  } catch { /* ignore */ }
  return 'all';
};

export default function Assets() {
  const [activeFilter, setActiveFilterState] = useState<FilterKey>(readStoredFilter);
  /** 包装 setter：同步写入 localStorage，刷新后仍记住上次选中 */
  const setActiveFilter = useCallback((next: FilterKey) => {
    setActiveFilterState(next);
    try { window.localStorage.setItem(ACTIVE_FILTER_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AssetRecord | null>(null);
  const [previewTarget, setPreviewTarget] = useState<AssetRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState('');
  /** 虚拟人分组详情视图中当前分组 ID（null = 不在详情视图） */
  const [characterDetailGroupId, setCharacterDetailGroupId] = useState<string | null>(null);
  /** 虚拟人分组详情刷新触发器（上传后 +1 触发 CharacterLibrary 重新拉取） */
  const [characterRefreshTick, setCharacterRefreshTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 筛选切换时全量拉取（size=60，按 total 自动分页）
  // 虚拟人视图由 CharacterLibrary 组件自行管理数据，不在此拉取
  useEffect(() => {
    if (activeFilter === 'character') return;
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

  const isCharacterView = activeFilter === 'character';

  /** 上传素材：presign 获取预签名 URL → PUT 直传对象存储 → complete 登记 */
  const handleUpload = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || uploading) return;
    const list = Array.from(files);
    // 先清空 input 以支持重复上传同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';

    // 虚拟人分组详情视图：走素材库 API（支持图片+视频）
    if (isCharacterView && characterDetailGroupId) {
      setUploading(true);
      setActionError('');
      const errors: string[] = [];

      for (const file of list) {
        // 支持图片和视频
        let assetType: 'Image' | 'Video' | 'Audio';
        if (file.type.startsWith('image/')) assetType = 'Image';
        else if (file.type.startsWith('video/')) assetType = 'Video';
        else {
          errors.push(`${file.name}：仅支持图片和视频`);
          continue;
        }
        try {
          // Step 1: 上传到 Asset 管道拿公网 URL
          const uploadResult = await uploadAssetFile(file);
          // Step 2: 调用素材库 CreateAsset
          await createMaterialAsset({
            GroupId: characterDetailGroupId,
            URL: uploadResult.url,
            Name: file.name,
            AssetType: assetType,
          });
        } catch (err) {
          errors.push(isApiError(err) ? `${file.name}：${err.message}` : `上传失败：${file.name}`);
        }
      }

      if (errors.length) setActionError(errors.join('；'));
      setUploading(false);
      // 触发 CharacterLibrary 刷新
      setCharacterRefreshTick((t) => t + 1);
      return;
    }

    // 普通资产视图（图片/视频/音频）
    setUploading(true);
    setActionError('');
    const errors: string[] = [];

    for (const file of list) {
      // 虚拟人视图下，上传类型固定为 character
      const forceCharacter = activeFilter === 'character';
      const type: AssetType = forceCharacter ? 'character' : (fileToAssetType(file) as AssetType);

      if (!type) {
        errors.push(`不支持的文件类型：${file.name}`);
        continue;
      }
      // tab 筛选下的类型约束：选中特定 tab 时只允许对应类型（同时校验 MIME 和扩展名）
      if (!forceCharacter && activeFilter !== 'all' && activeFilter !== type) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        errors.push(`${file.name}：当前「${filterTabs.find((t) => t.key === activeFilter)?.label}」tab 不支持 .${ext || '?'} 格式`);
        continue;
      }
      const limitMb = Math.round(UPLOAD_SIZE_LIMIT[type] / 1024 / 1024);
      if (file.size > UPLOAD_SIZE_LIMIT[type]) {
        errors.push(`${file.name} 超过 ${limitMb}MB 上限`);
        continue;
      }
      // 虚拟人视图只接受图片
      if (forceCharacter && !file.type.startsWith('image/')) {
        errors.push(`${file.name}：虚拟人仅支持上传图片`);
        continue;
      }
      try {
        // 三步上传：presign → PUT → complete
        const presign = await fetchUploadPresign({ type, mime: file.type, size: file.size });
        await putToPresignedUrl(presign, file);
        const done = await completeUpload({
          type,
          mime: file.type,
          size: file.size,
          storage_key: presign.storage_key,
          ...(forceCharacter ? {} : {}),
        });
        // 登记成功：新资产插入列表顶部
        setAssets((prev) => [
          {
            id: done.asset_id,
            type: done.type,
            url: done.url || URL.createObjectURL(file),
            width: done.width || null,
            height: done.height || null,
            duration: done.duration,
            size: file.size,
            source: 'uploaded',
            model: null,
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
        {/* 顶部标题栏：虚拟人像库详情视图下隐藏 */}
        {!(isCharacterView && characterDetailGroupId) && (
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

            {actionError && <span className={styles.actionError}>{actionError}</span>}
          </div>
        </div>
        )}

        {/* 隐藏的文件上传 input：始终渲染，详情视图也能触发 */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={(() => {
            if (isCharacterView && characterDetailGroupId) return '.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm';
            if (activeFilter === 'image') return '.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp';
            if (activeFilter === 'video') return '.mp4,.webm,.mov,.avi,.mkv';
            if (activeFilter === 'audio') return '.mp3,.wav,.ogg,.m4a,.aac,.flac';
            return '.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.mp4,.webm,.mov,.avi,.mkv,.mp3,.wav,.ogg,.m4a,.aac,.flac';
          })()}
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />

        {/* 虚拟人视图：独立的分组 + 素材管理 */}
        {isCharacterView ? (
          <CharacterLibrary
            refreshTick={characterRefreshTick}
            onDetailViewChange={(inDetail, groupId) => setCharacterDetailGroupId(inDetail ? groupId : null)}
            onUpload={handleUpload}
          />
        ) : (
          /* 资产网格（2-5 列自适应） */
          <div className={styles.grid}>
            {loading &&
              Array.from({ length: 10 }, (_, index) => (
                <Skeleton key={index} className={styles.cardSkeleton} />
              ))}
            {!loading && loadError && <div className={styles.empty}>{loadError}</div>}

            {!loading && !loadError && activeFilter !== 'all' && (
              /* 第一个位置：上传素材卡片（仅非"全部"tab 显示） */
              <div
                className={`${styles.card} ${styles.uploadCard}`}
                onClick={handleUpload}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleUpload(); }}
                aria-label="上传素材"
              >
                <div className={`${styles.thumbnail} ${styles.uploadThumb}`}>
                  <Plus size={32} strokeWidth={1.5} />
                  <span>上传素材</span>
                </div>
              </div>
            )}

            {!loading &&
              !loadError &&
              displayAssets.map((asset) => (
                <div
                  key={String(asset.id)}
                  className={styles.card}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看${typeLabel[asset.type]}资产详情`}
                  onClick={() => setPreviewTarget(asset)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setPreviewTarget(asset);
                    }
                  }}
                >
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
        )}
      </div>

      <AssetDetailModal asset={previewTarget} onClose={() => setPreviewTarget(null)} />

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
