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
import { AudioLines, X } from 'lucide-react';
import styles from './index.module.css';

export interface VideoMentionChipProps {
  url: string;
  label: string;
  /** 输入框里的胶囊要移除按钮；历史消息里不要。 */
  onRemove?: (() => void) | undefined;
}

/**
 * 画布视频提及胶囊：小视频缩略图 + 文件名；悬浮静音循环播放。
 * 视觉对齐 ImageMentionChip，交互对齐 AssetChip 的视频预览。
 */
export function VideoMentionChip({ url, label, onRemove }: VideoMentionChipProps) {
  return <MediaMentionChip url={url} label={label} onRemove={onRemove} mediaType="video" />;
}

export function AudioMentionChip({ url, label, onRemove }: VideoMentionChipProps) {
  return <MediaMentionChip url={url} label={label} onRemove={onRemove} mediaType="audio" />;
}

function MediaMentionChip({ url, label, onRemove, mediaType }: VideoMentionChipProps & { mediaType: 'video' | 'audio' }) {
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
        aria-label={`预览${mediaType === 'audio' ? '音频' : '视频'}：${label}`}
        {...getReferenceProps()}
      >
        {mediaType === 'audio' ? <AudioLines size={15} /> : <video className={styles.thumb} src={url} muted playsInline preload="metadata" />}
        <span className={styles.label} title={label}>{label}</span>
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
            className={mediaType === 'audio' ? styles.audioPreview : styles.preview}
            style={floatingStyles}
            role="tooltip"
            contentEditable={false}
            {...getFloatingProps()}
          >
            {mediaType === 'audio' ? <audio src={url} controls preload="metadata" aria-label={`播放音频：${label}`} /> : <video src={url} autoPlay muted loop playsInline />}
          </span>
        </FloatingPortal>
      )}
    </>
  );
}

export default VideoMentionChip;
