/* ============================================
 * Assets 资产页面：GET /api/assets 分页拉取 + 类型筛选 + 真实媒体预览
 * ============================================ */

import { memo, useEffect, useRef, useState, useCallback, useLayoutEffect, useMemo, type RefObject } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Trash2, RotateCw, AlertCircle, Plus } from 'lucide-react';
import { assetKeys, assetPageQueryOptions, deleteAsset, UPLOAD_SIZE_LIMIT, fetchUploadPresign, putToPresignedUrl, completeUpload, type AssetRecord, type AssetType } from '@/api/assets';
import { createAsset as createMaterialAsset } from '@/api/material';
import { uploadAssetFile } from '@/utils/upload';
import { toast } from 'sonner';
import { isApiError } from '@/api/http';
import { fileToAssetType } from '@/utils/upload';
import { useInfiniteLoader, useMasonry, usePositioner, useResizeObserver, type RenderComponentProps } from 'masonic';
import ConfirmModal from '@/components/ConfirmModal';
import Skeleton from '@/components/Skeleton';
import AssetDetailModal from './components/AssetDetailModal';
import AudioPlayer, { type AudioPlayerHandle } from './components/AudioPlayer';
import CharacterLibrary from './components/CharacterLibrary';
import { assetMediaDisplay } from './assetMediaSrc';
import { appendUniqueAssets, assetAspectRatio } from './assetGrid';
import { startVideoPreview, stopVideoPreview } from './videoPreview';
import { getAssetFilter, setAssetFilter, type FilterKey } from './filterQuery';
import styles from './index.module.css';

/** 筛选按钮定义 */
const filterTabs: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'character', label: '虚拟人像库' },
];

/** Library 瀑布流每次只请求 30 条，避免首屏过量加载。 */
const LIBRARY_PAGE_SIZE = 30;

/** 类型标签文字 */
const typeLabel: Record<AssetType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  character: '虚拟人像',
};

/** 媒体加载状态 */
type MediaLoadState = 'waiting' | 'loading' | 'loaded' | 'error';

/** 单个资产媒体组件：图片与视频在未就绪（含失败）期间持续显示骨架屏。 */
function AssetMedia({
  asset,
  audioPlayerRef,
}: {
  asset: AssetRecord;
  audioPlayerRef?: RefObject<AudioPlayerHandle | null>;
}) {
  const isSafari = isSafariBrowser();
  // Safari 视频初始为 waiting（懒加载），其余直接进入 loading
  const [state, setState] = useState<MediaLoadState>(
    asset.type === 'video' && isSafari ? 'waiting' : 'loading',
  );
  const [reloadKey, setReloadKey] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const isVisualMedia = asset.type !== 'audio';

  const { src: mediaSrc, nodeKey: mediaKey } = assetMediaDisplay(asset.url, reloadKey);

  // URL 或 reloadKey 变化时，在首帧绘制前重置为 loading。
  // 复用的瀑布流卡片可能仍保留上一个资源的 loaded 状态；若放在 useEffect，
  // 浏览器会先绘制一次旧播放器，再显示骨架屏，造成音频播放器闪烁。
  // 视频通过 VideoThumb 的 onLoaded/onError 驱动状态，不在这里重置。
  useLayoutEffect(() => {
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
  }, [mediaSrc, reloadKey]);

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
      {/* 图片、视频和虚拟人像在加载或失败时都保持与卡片同尺寸的骨架屏。 */}
      {isVisualMedia && state !== 'loaded' && <Skeleton className={styles.mediaSkeleton} />}

      {/* 音频元数据加载期间也用固定尺寸骨架屏，避免卡片在瀑布流中跳动。 */}
      {!isVisualMedia && state === 'loading' && <Skeleton className={styles.audioMediaSkeleton} />}

      {!isVisualMedia && state === 'error' && (
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
          key={mediaKey}
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
          key={mediaKey}
          url={mediaSrc}
          onInView={() => setState('loading')}
          onLoaded={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      {asset.type === 'audio' && asset.url && (
        <AudioPlayer
          key={mediaKey}
          ref={audioPlayerRef}
          src={mediaSrc}
          variant="compact"
          className={styles.audioCardPlayer}
          onLoadedMetadata={() => setState('loaded')}
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

  const startPreview = () => {
    startVideoPreview(videoRef.current);
  };

  const stopPreview = () => {
    stopVideoPreview(videoRef.current);
  };

  useEffect(() => () => stopVideoPreview(videoRef.current), []);

  return (
    <div
      ref={containerRef}
      className={styles.videoContainer}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
    >
      <video
        ref={videoRef}
        className={styles.media}
        src={inView ? url : undefined}
        muted
        playsInline
        preload="metadata"
        onLoadedData={() => onLoaded?.()}
        onError={() => onError?.()}
      />
    </div>
  );
}

type AssetGridItem =
  | { kind: 'asset'; asset: AssetRecord }
  | { kind: 'upload' };

interface AssetMasonryProps {
  items: AssetGridItem[];
  totalItems: number;
  onLoadMore: () => Promise<void>;
  scrollContainerRef: { current: HTMLDivElement | null };
  onUpload: () => void;
  onPreview: (asset: AssetRecord) => void;
  onDelete: (asset: AssetRecord) => void;
}

function AssetCard({
  asset,
  onPreview,
  onDelete,
}: Pick<AssetMasonryProps, 'onPreview' | 'onDelete'> & { asset: AssetRecord }) {
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);
  const isAudio = asset.type === 'audio';

  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      aria-label={`查看${typeLabel[asset.type]}资产详情`}
      onMouseEnter={() => {
        if (isAudio) audioPlayerRef.current?.startPreview();
      }}
      onMouseLeave={() => {
        if (isAudio) audioPlayerRef.current?.stopPreview();
      }}
      onClick={() => onPreview(asset)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPreview(asset);
        }
      }}
    >
      <div className={styles.thumbnail} style={{ aspectRatio: assetAspectRatio(asset) }}>
        {asset.url ? (
          <AssetMedia asset={asset} audioPlayerRef={isAudio ? audioPlayerRef : undefined} />
        ) : (asset.type === 'image' || asset.type === 'video' || asset.type === 'character') ? (
          <Skeleton className={styles.mediaSkeleton} />
        ) : (
          <div className={styles.mediaError}>
            <AlertCircle size={28} />
            <span className={styles.mediaErrorText}>资源不可用</span>
          </div>
        )}
        <span className={styles.typeBadge}>{typeLabel[asset.type]}</span>
        <button
          className={styles.deleteBtn}
          title="删除资产"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(asset);
          }}
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/**
 * Masonic 默认监听 window；资产页自身是滚动容器，因此在这里把它的可视区域
 * 和 scrollTop 传给底层 hook，保留其虚拟化及无限加载能力。
 */
const AssetMasonry = memo(function AssetMasonry({
  items,
  totalItems,
  onLoadMore,
  scrollContainerRef,
  onUpload,
  onPreview,
  onDelete,
}: AssetMasonryProps) {
  const gridRef = useRef<HTMLElement>(null);
  const scrollStopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [viewport, setViewport] = useState({ width: 1, height: 1, scrollTop: 0 });
  const [isScrolling, setIsScrolling] = useState(false);

  const updateViewport = useCallback(() => {
    const scroller = scrollContainerRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid) return;

    const gridOffset =
      grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const next = {
      width: Math.max(1, grid.offsetWidth),
      height: Math.max(1, scroller.clientHeight),
      scrollTop: Math.max(0, scroller.scrollTop - gridOffset),
    };

    setViewport((current) => (
      current.width === next.width &&
      current.height === next.height &&
      current.scrollTop === next.scrollTop
        ? current
        : next
    ));
  }, [scrollContainerRef]);

  useLayoutEffect(() => {
    const scroller = scrollContainerRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid) return undefined;

    const handleScroll = () => {
      updateViewport();
      setIsScrolling(true);
      if (scrollStopTimer.current) clearTimeout(scrollStopTimer.current);
      scrollStopTimer.current = setTimeout(() => setIsScrolling(false), 120);
    };

    updateViewport();
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateViewport);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(updateViewport);
    resizeObserver?.observe(scroller);
    resizeObserver?.observe(grid);

    return () => {
      scroller.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateViewport);
      resizeObserver?.disconnect();
      if (scrollStopTimer.current) clearTimeout(scrollStopTimer.current);
    };
  }, [scrollContainerRef, updateViewport]);

  const positioner = usePositioner({
    width: viewport.width,
    columnCount: 5,
    columnGutter: 16,
    rowGutter: 16,
  });
  const resizeObserver = useResizeObserver(positioner);

  const loadMoreItems = useCallback((_: number, __: number, ___: AssetGridItem[]) => {
    void onLoadMore();
  }, [onLoadMore]);
  const onRender = useInfiniteLoader<AssetGridItem, typeof loadMoreItems>(loadMoreItems, {
    minimumBatchSize: LIBRARY_PAGE_SIZE,
    threshold: 16,
    totalItems,
  });
  const renderCard = useCallback(({ data }: RenderComponentProps<AssetGridItem>) => {
    if (data.kind === 'upload') {
      return (
        <div
          className={`${styles.card} ${styles.uploadCard}`}
          onClick={onUpload}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => { if (event.key === 'Enter') onUpload(); }}
          aria-label="上传素材"
        >
          <div className={`${styles.thumbnail} ${styles.uploadThumb}`}>
            <Plus size={32} strokeWidth={1.5} />
            <span>上传素材</span>
          </div>
        </div>
      );
    }

    return <AssetCard asset={data.asset} onPreview={onPreview} onDelete={onDelete} />;
  }, [onDelete, onPreview, onUpload]);

  return useMasonry({
    positioner,
    resizeObserver,
    items,
    render: renderCard,
    onRender,
    className: styles.masonry,
    containerRef: gridRef,
    itemKey: (item) => (item.kind === 'upload' ? 'upload' : String(item.asset.id)),
    itemHeightEstimate: 240,
    height: viewport.height,
    scrollTop: viewport.scrollTop,
    isScrolling,
    overscanBy: 2,
    role: 'list',
    tabIndex: -1,
  });
});

export default function Assets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const activeFilter = getAssetFilter(searchParams);

  /** 筛选状态由 URL 承载，方便分享链接并响应浏览器前进/后退。 */
  const setActiveFilter = useCallback((next: FilterKey) => {
    setSearchParams(setAssetFilter(searchParams, next));
  }, [searchParams, setSearchParams]);
  const [deleteTarget, setDeleteTarget] = useState<AssetRecord | null>(null);
  const [previewTarget, setPreviewTarget] = useState<AssetRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** 虚拟人分组详情视图中当前分组 ID（null = 不在详情视图） */
  const [characterDetailGroupId, setCharacterDetailGroupId] = useState<string | null>(null);
  /** 虚拟人分组详情刷新触发器（上传后 +1 触发 CharacterLibrary 重新拉取） */
  const [characterRefreshTick, setCharacterRefreshTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const isCharacterView = activeFilter === 'character';
  const assetType = activeFilter === 'all' ? '' : activeFilter;
  const {
    data: assetData,
    fetchNextPage,
    hasNextPage,
    isError: isAssetQueryError,
    isFetchingNextPage,
    isPending: isAssetQueryPending,
  } = useInfiniteQuery({
    ...assetPageQueryOptions(assetType, LIBRARY_PAGE_SIZE),
    enabled: !isCharacterView,
  });
  const assetPages = assetData?.pages;
  const assets = useMemo(
    () => appendUniqueAssets([], assetPages?.flatMap((page) => page.records) ?? []),
    [assetPages],
  );
  const assetTotal = assetPages?.at(-1)?.total ?? 0;
  const loading = !isCharacterView && (isAssetQueryPending || (!assetPages && isAssetQueryError));
  const loadingMore = isFetchingNextPage;
  const hasMore = hasNextPage;

  const loadNextPage = useCallback(async () => {
    if (isCharacterView || !hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isCharacterView, isFetchingNextPage]);

  /** 上传素材：presign 获取预签名 URL → PUT 直传对象存储 → complete 登记 */
  const handleUpload = useCallback(() => {
    if (uploading) return;
    fileInputRef.current?.click();
  }, [uploading]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || uploading) return;
    const list = Array.from(files);
    // 先清空 input 以支持重复上传同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';

    // 虚拟人分组详情视图：走素材库 API（支持图片+视频）
    if (isCharacterView && characterDetailGroupId) {
      setUploading(true);
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
          // Step 2: 调用素材库 CreateAsset（名称限 30 字，超限截断）
          const rawName = file.name;
          const finalName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;
          if (rawName.length > 30) toast('当前上传素材名称过长，已截取', { style: { textAlign: 'center' } });
          await createMaterialAsset({
            GroupId: characterDetailGroupId,
            URL: uploadResult.url,
            Name: finalName,
            AssetType: assetType,
          });
        } catch (err) {
          // API 错误已由请求层统一 toast，这里只收集本地校验类错误
          if (!isApiError(err)) errors.push(`上传失败：${file.name}`);
        }
      }

      if (errors.length) toast.error(errors.join('；'));
      setUploading(false);
      // 触发 CharacterLibrary 刷新
      setCharacterRefreshTick((t) => t + 1);
      return;
    }

    // 普通资产视图（图片/视频/音频）
    setUploading(true);
    const errors: string[] = [];
    let assetListChanged = false;

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
        await completeUpload({
          type,
          mime: file.type,
          size: file.size,
          storage_key: presign.storage_key,
          ...(forceCharacter ? {} : {}),
        });
        // 上传会改变“全部”和对应类型缓存；本轮批量上传结束后统一失效并刷新。
        assetListChanged = true;
      } catch (err) {
        // API 错误已由请求层统一 toast，这里只收集本地校验类错误
        if (!isApiError(err)) errors.push(`上传失败：${file.name}`);
      }
    }

    if (assetListChanged) {
      await queryClient.invalidateQueries({ queryKey: assetKeys.all });
      // 新资产插在首位，会改变所有 index；重建 positioner 避免旧布局缓存错位。
      setLayoutVersion((version) => version + 1);
    }
    if (errors.length) toast.error(errors.join('；'));
    setUploading(false);
  };

  const assetItems = useMemo<AssetGridItem[]>(
    () => assets.map((asset) => ({ kind: 'asset' as const, asset })),
    [assets],
  );
  const gridItems = useMemo<AssetGridItem[]>(
    () => activeFilter === 'all' ? assetItems : [{ kind: 'upload' }, ...assetItems],
    [activeFilter, assetItems],
  );
  const totalGridItems = assetTotal + (activeFilter === 'all' ? 0 : 1);

  /** 确认删除：删除成功后失效素材列表缓存并刷新当前筛选。 */
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteAsset(deleteTarget.id);
      await queryClient.invalidateQueries({ queryKey: assetKeys.all });
      // 删除会缩短数组，必须重建 Masonic 缓存，避免保留已删除 index 的定位信息。
      setLayoutVersion((version) => version + 1);
      setDeleteTarget(null);
    } catch (e) {
      // API 错误已由请求层统一 toast，这里兜底非 API 错误（如网络中断）
      if (!isApiError(e)) toast.error('删除失败，请稍后重试');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div ref={pageRef} className={styles.page}>
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
          <>
            {loading &&
              <div className={styles.skeletonGrid}>
                {Array.from({ length: 10 }, (_, index) => (
                  <Skeleton key={index} className={styles.cardSkeleton} />
                ))}
              </div>}
            {!loading && gridItems.length > 0 && (
              <AssetMasonry
                key={`${activeFilter}:${layoutVersion}`}
                items={gridItems}
                totalItems={hasMore ? totalGridItems : gridItems.length}
                onLoadMore={loadNextPage}
                scrollContainerRef={pageRef}
                onUpload={handleUpload}
                onPreview={setPreviewTarget}
                onDelete={setDeleteTarget}
              />
            )}
            {!loading && gridItems.length === 0 && (
              <div className={styles.empty}>暂无素材</div>
            )}
            {!loading && loadingMore && (
              <div className={styles.loadState} role="status">加载中…</div>
            )}
            {!loading && !hasMore && assets.length > 0 && (
              <div className={styles.loadState}>已加载全部素材</div>
            )}
          </>
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
