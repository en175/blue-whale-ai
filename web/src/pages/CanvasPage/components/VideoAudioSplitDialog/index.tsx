import { useRef, useState } from 'react';
import { ArrowUp, ChevronDown, X } from 'lucide-react';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { AUDIO_VIDEO_SPLIT_FORMATS, type AudioVideoSplitFormat } from '../../audioVideoSplit';
import styles from './index.module.css';

interface VideoAudioSplitDialogProps {
  onClose: () => void;
  format: AudioVideoSplitFormat;
  onFormatChange: (format: AudioVideoSplitFormat) => void;
  onSend: () => void;
  submitting?: boolean;
  sendBarAnchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function VideoAudioSplitDialog({
  onClose,
  format,
  onFormatChange,
  onSend,
  submitting,
  sendBarAnchor, dragHidden,
}: VideoAudioSplitDialogProps) {
  const readOnly = submitting === true;

  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const formatWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside([
    { open: formatMenuOpen, ref: formatWrapRef, dismiss: () => setFormatMenuOpen(false) },
  ]);

  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    <div
      className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
      style={anchoredOverlayStyle(sendBarAnchor, dragHidden)}
      data-gen-panel-territory
      data-testid="audio-video-split-send-bar"
    >
      <button
        type="button"
        className={styles.toolBtn}
        data-testid="audio-video-split-close"
        title="退出音视频分离（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.divider} aria-hidden />

      {}
      <div className={styles.formatWrap} ref={formatWrapRef}>
        <button
          type="button"
          className={styles.formatTrigger}
          data-testid="audio-video-split-format-trigger"
          aria-haspopup="menu"
          aria-expanded={formatMenuOpen || undefined}
          disabled={readOnly}
          title="选择音频输出格式（产物文件名后缀跟随所选格式）"
          onClick={guarded(readOnly, () => setFormatMenuOpen((open) => !open))}
        >
          <span>{format.toUpperCase()}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
        {formatMenuOpen && (
          <div
            className={styles.formatMenu}
            role="menu"
            data-testid="audio-video-split-format-menu"
          >
            {AUDIO_VIDEO_SPLIT_FORMATS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === format}
                className={`${styles.formatMenuItem} ${item === format ? styles.formatMenuItemActive : ''}`}
                data-testid={`audio-video-split-format-item-${item}`}
                onClick={() => {
                  onFormatChange(item);
                  setFormatMenuOpen(false);
                }}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className={styles.freeHint}>本期免费</span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="audio-video-split-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '发送音视频分离任务'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
