import { memo, useEffect, useRef, useState, useCallback, useLayoutEffect, type RefObject } from 'react';
import { useInfiniteLoader, useMasonry, usePositioner, useResizeObserver, type RenderComponentProps } from 'masonic';
import { Trash2, RotateCw, AlertCircle, Check, ZoomIn } from 'lucide-react';
import type { AssetRecord } from '@/api/assets';
import Skeleton from '@/components/Skeleton';
import AudioPlayer, { type AudioPlayerHandle } from '../AudioPlayer';
import { assetMediaDisplay } from '../../assetMediaSrc';
import { remoteImageCrossOrigin } from '@/utils/remoteImageCors';
import { assetAspectRatio, typeLabel } from '../../assetGrid';
import { startVideoPreview, stopVideoPreview } from '../../videoPreview';
import styles from '../../index.module.css';

type MediaLoadState = 'waiting' | 'loading' | 'loaded' | 'error';

export function AssetMedia({
  asset,
  audioPlayerRef,
}: {
  asset: AssetRecord;
  audioPlayerRef?: RefObject<AudioPlayerHandle | null>;
}) {
  const isSafari = isSafariBrowser();
  const [state, setState] = useState<MediaLoadState>(
    asset.type === 'video' && isSafari ? 'waiting' : 'loading',
  );
  const [reloadKey, setReloadKey] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const completedResourceKeyRef = useRef<string | null>(null);
  const isVisualMedia = asset.type !== 'audio';

  const { src: mediaSrc, nodeKey: mediaKey } = assetMediaDisplay(asset.url, reloadKey);
  const resourceKey = `${asset.type}:${mediaKey}`;
  const markLoaded = useCallback(() => {
    completedResourceKeyRef.current = resourceKey;
    setState('loaded');
  }, [resourceKey]);
  const markLoading = useCallback(() => setState('loading'), []);
  const markError = useCallback(() => setState('error'), []);

  useLayoutEffect(() => {
    if (asset.type !== 'video') {
      setState(completedResourceKeyRef.current === resourceKey ? 'loaded' : 'loading');
    }
  }, [asset.type, resourceKey]);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      markLoaded();
    }
  }, [mediaSrc, reloadKey, markLoaded]);

  const handleReload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setReloadKey((k) => k + 1);
    if (asset.type === 'video' && isSafari) {
      setState('waiting');
    } else {
      setState('loading');
    }
  }, [asset.type, isSafari]);
  const showSkeleton = state === 'waiting' || state === 'loading';

  return (
    <>
      {}
      {isVisualMedia && showSkeleton && <Skeleton className={styles.mediaSkeleton} />}

      {}
      {!isVisualMedia && showSkeleton && <Skeleton className={styles.audioMediaSkeleton} />}

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

      {}
      {(asset.type === 'image' || asset.type === 'character') && asset.url && (
        <img
          key={mediaKey}
          ref={imgRef}
          className={styles.media}
          src={mediaSrc}
          crossOrigin={remoteImageCrossOrigin(mediaSrc)}
          alt=""
          loading="lazy"
          onLoad={markLoaded}
          onError={markError}
        />
      )}
      {asset.type === 'video' && asset.url && (
        <VideoThumb
          key={mediaKey}
          url={mediaSrc}
          onInView={markLoading}
          onLoaded={markLoaded}
          onError={markError}
        />
      )}
      {asset.type === 'audio' && asset.url && (
        <AudioPlayer
          key={mediaKey}
          ref={audioPlayerRef}
          src={mediaSrc}
          variant="compact"
          className={styles.audioCardPlayer}
          onLoadedMetadata={markLoaded}
          onError={markError}
        />
      )}
    </>
  );
}

function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /^((?!chrome|android|edge|opr|crios).)*safari/i.test(ua);
}

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

  useEffect(() => {
    if (!useLazy) {
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

  useEffect(() => {
    if (!inView) return;
    const video = videoRef.current;
    if (!video) return;

    const checkReady = () => {
      if (video.readyState >= 2) {
        onLoaded?.();
      }
    };

    checkReady();

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
  | { kind: 'asset'; asset: AssetRecord };

const EMPTY_ITEMS: AssetGridItem[] = [];

export interface AssetMasonryProps {
  items: AssetGridItem[];
  totalItems: number;
  onLoadMore: () => Promise<void>;
  scrollContainerRef: { current: HTMLDivElement | null };
  onPreview?: (asset: AssetRecord) => void;
  onDelete?: (asset: AssetRecord) => void;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (asset: AssetRecord) => void;
  columnCount?: number;
  pageSize?: number;
  gutter?: number;
  libraryMode?: boolean;
}

export function AssetCard({
  asset,
  onPreview,
  onDelete,
  selected,
  onToggleSelect,
  libraryMode,
}: Pick<AssetMasonryProps, 'onPreview' | 'onDelete' | 'onToggleSelect' | 'libraryMode'> & {
  asset: AssetRecord;
  selected: boolean;
}) {
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);
  const isAudio = asset.type === 'audio';
  const isSelectable = !!onToggleSelect;

  const handleClick = () => {
    if (isSelectable) onToggleSelect?.(asset);
    else onPreview?.(asset);
  };

  return (
    <div
      className={`${styles.card} ${libraryMode ? styles.libraryCard : ''}`}
      role="button"
      tabIndex={0}
      aria-label={isSelectable ? `选择${typeLabel[asset.type]}素材` : `查看${typeLabel[asset.type]}资产详情`}
      aria-pressed={isSelectable ? selected : undefined}
      onMouseEnter={() => {
        if (isAudio) audioPlayerRef.current?.startPreview();
      }}
      onMouseLeave={() => {
        if (isAudio) audioPlayerRef.current?.stopPreview();
      }}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
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
        {}
        {asset.type === 'video' && asset.video_stage && asset.video_stage !== 'video' && (
          <span className={styles.stageBadge}>
            {asset.video_stage === 'sample' ? '样片 480P' : '成片 1080P'}
          </span>
        )}
        {asset.material_status === 'Active' && (
          <span className={styles.complianceBadge} title="校验通过">
            <img src="/success.png" alt="" />
          </span>
        )}
        {}
        {isSelectable && (
          <span
            className={`${styles.selectBadge} ${selected ? styles.selectBadgeActive : ''}`}
            aria-hidden
          >
            {selected && <Check size={12} strokeWidth={3} />}
          </span>
        )}
        {(onDelete || (isSelectable && onPreview)) && (
          <div className={styles.cardActions}>
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
            {isSelectable && onPreview && (
              <button
                className={styles.previewBtn}
                title="放大预览"
                onClick={(event) => {
                  event.stopPropagation();
                  onPreview(asset);
                }}
              >
                <ZoomIn size={14} strokeWidth={2} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const AssetMasonry = memo(function AssetMasonry({
  items,
  totalItems,
  onLoadMore,
  scrollContainerRef,
  onPreview,
  onDelete,
  selectedIds,
  onToggleSelect,
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
    let resizeObserver: ResizeObserver | undefined;
    let handleScroll: (() => void) | undefined;
    let attachedScroller: HTMLElement | null = null;
    let raf = 0;

    const attach = () => {
      const scroller = scrollContainerRef.current;
      const grid = gridRef.current;
      if (!scroller || !grid) return false;
      attachedScroller = scroller;

      handleScroll = () => {
        updateViewport();
        setIsScrolling(true);
        if (scrollStopTimer.current) clearTimeout(scrollStopTimer.current);
        scrollStopTimer.current = setTimeout(() => setIsScrolling(false), 120);
      };

      updateViewport();
      scroller.addEventListener('scroll', handleScroll, { passive: true });
      window.addEventListener('resize', updateViewport);

      resizeObserver = typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(updateViewport);
      resizeObserver?.observe(scroller);
      resizeObserver?.observe(grid);
      return true;
    };

    if (!attach()) raf = requestAnimationFrame(attach);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (attachedScroller && handleScroll) attachedScroller.removeEventListener('scroll', handleScroll);
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
  const renderCard = useCallback(({ data }: RenderComponentProps<AssetGridItem>) => (
    <AssetCard
      asset={data.asset}
      onPreview={onPreview}
      onDelete={onDelete}
      selected={!!onToggleSelect && !!selectedIds?.has(String(data.asset.id))}
      onToggleSelect={onToggleSelect}
      libraryMode={libraryMode}
    />
  ), [libraryMode, onDelete, onPreview, onToggleSelect, selectedIds]);

  const measured = viewport.width > 1 && viewport.height > 1;

  return useMasonry({
    positioner,
    resizeObserver,
    items: measured ? items : EMPTY_ITEMS,
    render: renderCard,
    onRender,
    className: `${styles.masonry} ${libraryMode ? styles.libraryMasonry : ''}`,
    containerRef: gridRef,
    itemKey: (item) => String(item.asset.id),
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
