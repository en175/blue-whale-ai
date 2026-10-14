import { useState } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
} from '@floating-ui/react';
import { X } from 'lucide-react';
import { useAssetLookup } from './useAssetLookup';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import styles from './index.module.css';

export interface AssetChipProps {
  assetId?: string | undefined;
  label: string;
  mediaType?: 'image' | 'video' | undefined;
  onRemove?: (() => void) | undefined;
  className?: string | undefined;
}

const PREVIEW_MAX = 280;

export function AssetChip({ assetId, label, mediaType, onRemove, className }: AssetChipProps) {
  const lookup = useAssetLookup();
  const asset = lookup(assetId);
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const hover = useHover(context, {
    delay: { open: 120, close: 80 },
    handleClose: safePolygon(),
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss]);

  const kind = mediaType ?? (asset?.type === 'video' ? 'video' : asset?.type === 'image' ? 'image' : undefined);
  const previewable = Boolean(asset?.url) && (kind === 'image' || kind === 'video');

  return (
    <>
      <span
        ref={refs.setReference}
        className={`${styles.chip} ${previewable ? styles.chipLinked : ''} ${className ?? ''}`}
        {...getReferenceProps()}
      >
        {asset?.url && kind === 'image' ? (
          <img className={styles.chipThumb} src={resolveMediaSrc(asset.url)} crossOrigin={remoteImageCrossOrigin(asset.url)} alt="" loading="lazy" />
        ) : asset?.url && kind === 'video' ? (
          <video className={styles.chipThumb} src={resolveMediaSrc(asset.url)} muted playsInline preload="metadata" />
        ) : (
          <span className={styles.chipThumbFallback} aria-hidden="true" />
        )}
        <span className={styles.chipLabel}>{label}</span>
        {onRemove && (
          <button
            type="button"
            className={styles.chipRemove}
            title="移除引用"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onRemove}
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </span>

      {}
      {open && previewable && asset && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className={styles.preview}
            style={{ ...floatingStyles, maxWidth: PREVIEW_MAX }}
            {...getFloatingProps()}
          >
            {kind === 'video' ? (
              <video
                className={styles.previewMedia}
                src={resolveMediaSrc(asset.url)}
                style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              <img
                className={styles.previewMedia}
                src={resolveMediaSrc(asset.url)}
                crossOrigin={remoteImageCrossOrigin(asset.url)}
                style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
                alt={label}
              />
            )}
            <span className={styles.previewCaption}>已关联素材 · {label}</span>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export default AssetChip;
