/* ============================================
 * AssetMasonry — 资产素材瀑布流（资产页与画布资产库选择弹窗共用）
 * 从资产页内联实现抽提：masonic v4 useMasonry + 滚动容器参数化 + 触底无限加载
 * ============================================ */
import { memo, useEffect, useRef, useState, useCallback, useLayoutEffect, type RefObject } from 'react';
import { useInfiniteLoader, useMasonry, usePositioner, useResizeObserver, type RenderComponentProps } from 'masonic';
import { Trash2, RotateCw, AlertCircle, Plus } from 'lucide-react';
import type { AssetRecord } from '@/api/assets';
import Skeleton from '@/components/Skeleton';
import AudioPlayer, { type AudioPlayerHandle } from '../AudioPlayer';
import { assetMediaDisplay } from '../../assetMediaSrc';
import { assetAspectRatio, typeLabel } from '../../assetGrid';
import { startVideoPreview, stopVideoPreview } from '../../videoPreview';
import styles from '../../index.module.css';

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

export type AssetGridItem =
  | { kind: 'asset'; asset: AssetRecord }
  | { kind: 'upload' };

/** 未测量到真实视口时传给 useMasonry 的空列表（模块级常量保持引用稳定） */
const EMPTY_ITEMS: AssetGridItem[] = [];

export interface AssetMasonryProps {
  items: AssetGridItem[];
  totalItems: number;
  onLoadMore: () => Promise<void>;
  scrollContainerRef: { current: HTMLDivElement | null };
  /** 卡片点击回调（资产页打开详情，选择弹窗表示选中） */
  onPreview: (asset: AssetRecord) => void;
  /** 删除回调；不传则不渲染悬浮删除按钮 */
  onDelete?: (asset: AssetRecord) => void;
  /** 上传入口卡回调；不传则不渲染上传卡行为 */
  onUpload?: () => void;
  /** 瀑布流列数（资产页 5 列，弹窗内更窄可减少） */
  columnCount?: number;
  /** 无限加载批大小（对应每次分页条数） */
  pageSize?: number;
  /** 卡片水平与垂直间距；资产库可用更紧凑的布局，弹窗保留默认间距。 */
  gutter?: number;
  /** 仅 /library 页使用的视觉调整，不影响画布资产选择器。 */
  libraryMode?: boolean;
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
      <div
        className={`${styles.thumbnail} ${isAudio ? styles.audioThumbnail : ''}`}
        style={{ aspectRatio: assetAspectRatio(asset) }}
      >
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
        {onDelete && (
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
        )}
      </div>
    </div>
  );
}

/**
 * Masonic 默认监听 window；调用方提供自身的滚动容器（资产页为页面本身，
 * 选择弹窗为弹窗内容区），这里把它的可视区域和 scrollTop 传给底层 hook，
 * 保留其虚拟化及无限加载能力。
 */
const AssetMasonry = memo(function AssetMasonry({
  items,
  totalItems,
  onLoadMore,
  scrollContainerRef,
  onPreview,
  onDelete,
  onUpload,
  columnCount = 5,
  pageSize = 30,
  gutter = 16,
  libraryMode = false,
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
    columnCount,
    columnGutter: gutter,
    rowGutter: gutter,
  });
  const resizeObserver = useResizeObserver(positioner);

  const loadMoreItems = useCallback((_: number, __: number, ___: AssetGridItem[]) => {
    void onLoadMore();
  }, [onLoadMore]);
  const onRender = useInfiniteLoader<AssetGridItem, typeof loadMoreItems>(loadMoreItems, {
    minimumBatchSize: pageSize,
    threshold: 16,
    totalItems,
  });
  const renderCard = useCallback(({ data }: RenderComponentProps<AssetGridItem>) => {
    if (data.kind === 'upload') {
      if (!onUpload) return null;
      return (
        <div
          className={`${styles.card} ${styles.uploadCard} ${libraryMode ? styles.libraryUploadCard : ''}`}
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
  }, [libraryMode, onDelete, onPreview, onUpload]);

  // 首帧 viewport 仍为初始值 {width:1, height:1}：此时 positioner 会算出负数列宽
  // （如 (1-16*3)/4 = -12px），非法 CSS 使 phase-one 卡片退化为 width:auto 按内容
  // 撑满容器，污染的高度测量还会被拷贝到重建后的 positioner，导致只剩一张巨图
  // 占满窗口（ResizeObserver 纠正存在竞态，偶发卡死）。因此测量到真实视口前
  // 不渲染任何 item，让 positioner 始终以真实列宽全新构建。
  const measured = viewport.width > 1 && viewport.height > 1;

  return useMasonry({
    positioner,
    resizeObserver,
    items: measured ? items : EMPTY_ITEMS,
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

export default AssetMasonry;
