import { useEffect, useRef, useState } from 'react';
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { AtSign, AudioLines, Crosshair, FileText, X } from 'lucide-react';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import styles from './index.module.css';
import type { StripDragItemProps } from './strip-dnd';

export type RefThumbnailKind = 'image' | 'video' | 'audio' | 'text';

export interface RefThumbnailProps {
  kind: RefThumbnailKind;
  url?: string;
  name: string;
  number?: number;
  badgeText?: string;
  locked?: boolean;
  onLocate?: () => void;
  onRemove?: () => void;
  onInsertRef?: () => void;
  insertTitle?: string;
  audioDuration?: number;
  textPreview?: string;
  dragProps?: StripDragItemProps;
  'data-testid'?: string;
  className?: string;
}

export const INSERT_REF_APPEND_TITLE = '插入引用（优先插入上次 @ 的位置，其次当前光标处，否则追加到正文末尾）';
export const INSERT_REF_AT_SELECTION_TITLE = '插入引用（优先插入上次 @ 的位置，其次当前光标处，否则追加到正文末尾）';

const PREVIEW_OPEN_DELAY = 200;
const TEXT_PREVIEW_CLOSE_DELAY = 120;
const PREVIEW_MAX = 280;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function containsPoint(target: Element, pointer: { x: number; y: number }): boolean {
  const rect = target.getBoundingClientRect();
  return pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom;
}

export function RefPreviewOverlay({ kind, url, name, audioDuration, textPreview, interactive, onMouseEnter, onMouseLeave, setFloating, style }: {
  kind: RefThumbnailKind;
  url?: string;
  name: string;
  audioDuration?: number;
  textPreview?: string;
  interactive?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  setFloating: (el: HTMLElement | null) => void;
  style: React.CSSProperties;
}) {
  return (
    <div
      ref={setFloating}
      className={styles.preview}
      style={{ ...style, pointerEvents: interactive ? 'auto' : 'none' }}
      role="tooltip"
      data-testid="ref-thumb-preview"
      onMouseEnter={interactive ? onMouseEnter : undefined}
      onMouseLeave={interactive ? onMouseLeave : undefined}
    >
      {kind === 'image' && url ? (
        <img
          className={styles.previewMedia}
          src={resolveMediaSrc(url)}
          crossOrigin={remoteImageCrossOrigin(url)}
          style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
          alt={name}
        />
      ) : kind === 'video' && url ? (
        <video
          className={styles.previewMedia}
          src={resolveMediaSrc(url)}
          style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
          autoPlay
          muted
          loop
          playsInline
          disablePictureInPicture
        />
      ) : kind === 'audio' ? (
        <div className={styles.audioCard}>
          <AudioLines size={16} strokeWidth={2} aria-hidden="true" />
          <span className={styles.previewName} title={name}>{name}</span>
          {audioDuration != null && <span className={styles.previewMeta}>{formatDuration(audioDuration)}</span>}
        </div>
      ) : (
        <div className={styles.textCard}>{textPreview}</div>
      )}
    </div>
  );
}

export function RefThumbnail({
  kind,
  url,
  name,
  number,
  badgeText,
  locked,
  onLocate,
  onRemove,
  onInsertRef,
  insertTitle,
  audioDuration,
  textPreview,
  dragProps,
  className,
  'data-testid': testId,
}: RefThumbnailProps) {
  const [hovered, setHovered] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const interactivePreview = kind === 'text';

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const previewable =
    kind === 'image' || kind === 'video'
      ? Boolean(url)
      : kind === 'audio'
        ? true
        : textPreview !== undefined;

  const clearOpenTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const handleMouseEnter = (event: React.MouseEvent) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
    setHovered(true);
    clearCloseTimer();
    if (!previewable) return;
    timerRef.current = setTimeout(() => setPreviewOpen(true), PREVIEW_OPEN_DELAY);
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleMouseLeave = () => {
    setHovered(false);
    clearOpenTimer();
    if (interactivePreview) {
      clearCloseTimer();
      closeTimerRef.current = setTimeout(() => setPreviewOpen(false), TEXT_PREVIEW_CLOSE_DELAY);
    } else {
      setPreviewOpen(false);
    }
  };

  useEffect(() => {
    if (!previewOpen) return;
    const handleScroll = () => {
      const pointer = pointerRef.current;
      const anchor = refs.reference.current;
      if (!pointer || !(anchor instanceof Element)) return;
      if (containsPoint(anchor, pointer)) return;
      const floating = refs.floating.current;
      if (interactivePreview && floating && containsPoint(floating, pointer)) return;
      handleMouseLeave();
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen]);

  const handleOverlayMouseLeave = () => {
    if (!interactivePreview) return;
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setPreviewOpen(false), TEXT_PREVIEW_CLOSE_DELAY);
  };

  const composedDragProps = dragProps
    ? {
        ...dragProps,
        onDragStart: (event: React.DragEvent<HTMLElement>) => {
          dragProps.onDragStart(event);
          clearOpenTimer();
          clearCloseTimer();
          setHovered(false);
          setPreviewOpen(false);
        },
      }
    : undefined;

  return (
    <div
      ref={refs.setReference}
      className={`${styles.thumb} ${locked ? styles.thumbLocked : ''} ${className ?? ''}`}
      data-testid={testId ?? 'ref-thumb'}
      data-hovered={hovered}
      data-locked={locked ? 'true' : undefined}
      title={locked ? `${name}（来自文本）` : name}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...composedDragProps}
    >
      {}
      {kind === 'image' && url ? <img src={resolveMediaSrc(url)} crossOrigin={remoteImageCrossOrigin(url)} alt={name} draggable={false} /> : null}
      {kind === 'video' && url ? <video src={resolveMediaSrc(url)} muted playsInline preload="metadata" draggable={false} disablePictureInPicture /> : null}
      {kind === 'audio' ? <AudioLines className={styles.kindIcon} aria-hidden="true" /> : null}
      {kind === 'text' ? <FileText className={styles.kindIcon} aria-hidden="true" /> : null}
      {(badgeText ?? number) != null && (
        <span className={styles.badge} data-testid="ref-thumb-badge">{badgeText ?? number}</span>
      )}
      {locked && onLocate && (
        <button
          type="button"
          className={`${styles.act} ${styles.actLocate}`}
          title="此素材由文本索引提供，请修改来源文本"
          aria-label={`定位来源文本 ${name}`}
          onClick={onLocate}
        >
          <Crosshair size={10} strokeWidth={2.5} />
        </button>
      )}
      {!locked && onRemove && (
        <button
          type="button"
          className={`${styles.act} ${styles.actRemove}`}
          title="移除"
          aria-label={`移除 ${name}`}
          onClick={onRemove}
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
      {onInsertRef && (
        <button
          type="button"
          className={`${styles.act} ${styles.actAt}`}
          title={insertTitle ?? '插入引用'}
          aria-label={`${insertTitle ?? '插入引用'} ${name}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onInsertRef}
        >
          <AtSign size={10} strokeWidth={2.5} />
        </button>
      )}
      {previewOpen && previewable && (
        <FloatingPortal>
          <RefPreviewOverlay
            kind={kind}
            url={url}
            name={name}
            audioDuration={audioDuration}
            textPreview={textPreview}
            interactive={interactivePreview}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={handleOverlayMouseLeave}
            setFloating={refs.setFloating}
            style={floatingStyles}
          />
        </FloatingPortal>
      )}
    </div>
  );
}

export default RefThumbnail;
