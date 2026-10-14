import { useContext, useEffect, useRef, useState } from 'react';
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import type { NodeKey } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { AlertTriangle, AudioLines } from 'lucide-react';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import { PromptRefContext } from './AssetRefNode';
import styles from '../mediaChip.module.css';

const PREVIEW_OPEN_DELAY_MS = 150;

export default function AssetRefChipComponent({
  nodeKey,
  assetId,
  invalidLabel,
}: {
  nodeKey: NodeKey;
  assetId: string;
  invalidLabel?: string;
}) {
  const { labels, meta, readOnly, onInvalidTagClick } = useContext(PromptRefContext);
  const [editor] = useLexicalComposerContext();
  const info = meta.get(assetId);

  const [previewOpen, setPreviewOpen] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const closePreview = () => {
    if (hoverTimerRef.current) { window.clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setPreviewOpen(false);
  };
  useEffect(() => () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
  }, []);
  const previewable = info !== undefined && info.mediaType !== 'text' && Boolean(info.url);

  const isImage = info?.mediaType === undefined || info.mediaType === 'image';
  const { refs, floatingStyles } = useFloating({
    open: previewOpen,
    placement: 'top-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  if (invalidLabel !== undefined) {
    return (
      <span
        className={`${styles.mediaChip} ${styles.mediaChipInvalid}`}
        contentEditable={false}
        title={`${info?.name ?? assetId}：原参考已移除。点击可替换为其他已引用素材，退格键删除该提及`}
        data-testid="asset-ref-invalid"
        role={onInvalidTagClick && !readOnly ? 'button' : undefined}
        tabIndex={onInvalidTagClick && !readOnly ? 0 : undefined}
        onMouseDown={(e) => {
          if (onInvalidTagClick && !readOnly) e.preventDefault();
        }}
        onClick={() => {
          if (onInvalidTagClick && !readOnly && editor.isEditable()) onInvalidTagClick(nodeKey);
        }}
        onKeyDown={(e) => {
          if (!onInvalidTagClick || readOnly || !editor.isEditable()) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onInvalidTagClick(nodeKey);
          }
        }}
      >
        <AlertTriangle size={12} strokeWidth={2} className={styles.mediaChipIcon} />
        <span className={styles.mediaChipLabel}>已失效：原{invalidLabel}</span>
      </span>
    );
  }
  const label = labels.get(assetId);
  return (
    <span
      ref={refs.setReference}
      className={styles.mediaChip}
      contentEditable={false}
      title={info?.name ?? assetId}
      data-testid="asset-ref-valid"
      onMouseEnter={() => {
        if (!previewable) return;
        if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = window.setTimeout(() => setPreviewOpen(true), PREVIEW_OPEN_DELAY_MS);
      }}
      onMouseLeave={closePreview}
    >
      {info?.url && isImage && <img className={styles.mediaChipThumb} src={resolveMediaSrc(info.url)} crossOrigin={remoteImageCrossOrigin(info.url)} alt="" />}
      {info?.url && info.mediaType === 'video' && <video className={styles.mediaChipThumb} src={resolveMediaSrc(info.url)} muted playsInline preload="metadata" />}
      {info?.mediaType === 'audio' && <span className={styles.mediaChipAudioIcon} aria-hidden="true">♫</span>}
      <span className={styles.mediaChipLabel}>{label ?? '素材?'}</span>
      {previewOpen && info && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className={styles.chipPreview}
            style={floatingStyles}
            role="tooltip"
            contentEditable={false}
            data-testid="asset-ref-preview"
          >
            {isImage && info.url && <img src={resolveMediaSrc(info.url)} crossOrigin={remoteImageCrossOrigin(info.url)} alt="" />}
            {info.mediaType === 'video' && <video src={resolveMediaSrc(info.url)} muted autoPlay loop playsInline />}
            {info.mediaType === 'audio' && <div className={styles.chipPreviewAudio}><AudioLines size={28} strokeWidth={1.5} /><span>音频</span></div>}
            <div className={styles.chipPreviewName}>{info.name}</div>
          </div>
        </FloatingPortal>
      )}
    </span>
  );
}
