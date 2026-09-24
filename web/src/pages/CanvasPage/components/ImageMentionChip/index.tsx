import { useState } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
} from '@floating-ui/react';
import { X } from 'lucide-react';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import styles from './index.module.css';

export interface ImageMentionChipProps {
  url: string;
  label: string;
  /** 悬停提示，不给就是 label。胶囊上写「图1」时放素材全名。 */
  title?: string | undefined;
  /** 输入框里的胶囊要移除按钮；历史消息里不要。 */
  onRemove?: (() => void) | undefined;
}

/**
 * 图片提及胶囊：小图缩略图 + 文件名；悬浮出大图。
 * 输入框与对话历史共用，避免两套长得不一样。
 */
export function ImageMentionChip({ url, label, title, onRemove }: ImageMentionChipProps) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-end',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: 100, close: 80 }, handleClose: safePolygon() });
  const focus = useFocus(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus]);

  return (
    <>
      <span
        ref={refs.setReference}
        className={styles.chip}
        contentEditable={false}
        aria-label={`查看原图：${title ?? label}`}
        {...getReferenceProps()}
      >
        <img className={styles.thumb} src={resolveMediaSrc(url)} crossOrigin={remoteImageCrossOrigin(url)} alt="" />
        <span className={styles.label} title={title ?? label}>{label}</span>
        {onRemove && (
          <button
            type="button"
            className={styles.remove}
            title="移除引用"
            aria-label={`移除 ${label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRemove}
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </span>
      {open && (
        <FloatingPortal>
          <span
            ref={refs.setFloating}
            className={styles.preview}
            style={floatingStyles}
            role="tooltip"
            {...getFloatingProps()}
          >
            <img src={resolveMediaSrc(url)} crossOrigin={remoteImageCrossOrigin(url)} alt={title ?? label} />
          </span>
        </FloatingPortal>
      )}
    </>
  );
}

export default ImageMentionChip;
