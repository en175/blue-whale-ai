import { ArrowUp, ChevronDown, X, Zap } from 'lucide-react';
import DropdownMenu from '@/custom/components/DropdownMenu';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import { AUDIO_TRIM_FORMATS, type AudioTrimFormat } from '../../audioTrim';
import { audioTrimRangeLabel } from '../../audioTrimGeometry';
import styles from './index.module.css';

interface AudioTrimBarProps {
  onClose: () => void;
  start: number;
  end: number;
  format: AudioTrimFormat;
  onFormatChange: (format: AudioTrimFormat) => void;
  onSend: () => void;
  submitting?: boolean;
  anchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function AudioTrimBar({
  onClose,
  start,
  end,
  format,
  onFormatChange,
  onSend,
  submitting,
  anchor, dragHidden,
}: AudioTrimBarProps) {
  const readOnly = submitting === true;

  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    <div
      className={`${styles.sendBar} ${anchor ? styles.sendBarFollow : ''}`}
      style={anchoredOverlayStyle(anchor, dragHidden)}
      data-gen-panel-territory
      data-testid="audio-trim-send-bar"
    >
      <button
        type="button"
        className={styles.closeBtn}
        data-testid="audio-trim-close"
        title="退出截取（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.title}>截取</span>
      <span className={styles.range} data-testid="audio-trim-range">
        {audioTrimRangeLabel({ start, end })}
      </span>
      {}
      <DropdownMenu
        modal={false}
        side="top"
        wrapClassName={styles.formatWrap}
        contentClassName={styles.formatMenu}
        contentTestId="audio-trim-format-menu"
        trigger={
          <button
            type="button"
            className={styles.formatTrigger}
            data-testid="audio-trim-format-trigger"
            aria-haspopup="menu"
            disabled={readOnly}
            title="选择输出格式（默认跟随源音频格式）"
          >
            <span>{format}</span>
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        }
        items={AUDIO_TRIM_FORMATS.map((item) => ({
          key: item,
          label: item,
          checked: item === format,
          testId: `audio-trim-format-item-${item}`,
          onSelect: () => onFormatChange(item),
        }))}
      />
      {}
      <span className={styles.free} title="本期免费" data-testid="audio-trim-free">
        <Zap size={11} fill="currentColor" strokeWidth={0} />
        0
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="audio-trim-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '生成截取音频'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
