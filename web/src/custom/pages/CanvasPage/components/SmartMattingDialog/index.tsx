import { SMART_MATTING_BACKGROUND_COLOR_LABELS, SMART_MATTING_FORMAT_LABELS, SMART_MATTING_MODE_LABELS } from '@/custom/enums';
import { useRef, useState } from 'react';
import { ArrowUp, ChevronDown, X, Zap } from 'lucide-react';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../agent/followDialog';
import { useDismissOnOutside } from '../../hooks/shared/useDismissOnOutside';
import { SMART_MATTING_BACKGROUND_COLORS, SMART_MATTING_FORMATS, type SmartMattingBackgroundColor, type SmartMattingFormat, type SmartMattingMode } from '../../tools/image/smartMatting';
import styles from './index.module.css';

interface SmartMattingDialogProps {
  onClose: () => void;
  mode: SmartMattingMode;
  format: SmartMattingFormat;
  onFormatChange: (format: SmartMattingFormat) => void;
  backgroundColor: SmartMattingBackgroundColor;
  onBackgroundColorChange: (color: SmartMattingBackgroundColor) => void;
  onSend: () => void;
  submitting?: boolean;
  sendBarAnchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function SmartMattingDialog({
  onClose,
  mode,
  format,
  onFormatChange,
  backgroundColor,
  onBackgroundColorChange,
  onSend,
  submitting,
  sendBarAnchor, dragHidden,
}: SmartMattingDialogProps) {
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
      data-testid="smart-matting-send-bar"
    >
      <button
        type="button"
        className={styles.toolBtn}
        data-testid="smart-matting-close"
        title="退出智能抠像（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.barTitle} data-testid="smart-matting-title">
        {SMART_MATTING_MODE_LABELS[mode]}
      </span>
      {}
      <div className={styles.formatWrap} ref={formatWrapRef}>
        <button
          type="button"
          className={styles.formatTrigger}
          data-testid="smart-matting-format-trigger"
          aria-haspopup="menu"
          aria-expanded={formatMenuOpen || undefined}
          disabled={readOnly}
          title="选择输出格式（WEBM 透明背景 / MP4 纯色背景）"
          onClick={guarded(readOnly, () => setFormatMenuOpen((open) => !open))}
        >
          <span>{SMART_MATTING_FORMAT_LABELS[format]}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
        {formatMenuOpen && (
          <div
            className={styles.formatMenu}
            role="menu"
            data-testid="smart-matting-format-menu"
          >
            {SMART_MATTING_FORMATS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === format}
                className={`${styles.formatMenuItem} ${item === format ? styles.formatMenuItemActive : ''}`}
                data-testid={`smart-matting-format-item-${item}`}
                title={item === 'WEBM' ? '透明背景，兼容性好、体积小' : '纯色背景，可配背景色'}
                onClick={() => {
                  onFormatChange(item);
                  setFormatMenuOpen(false);
                }}
              >
                {SMART_MATTING_FORMAT_LABELS[item]}
              </button>
            ))}
          </div>
        )}
      </div>
      {}
      {format === 'MP4' && (
        <div
          className={styles.segmentGroup}
          role="radiogroup"
          aria-label="背景色"
          data-testid="smart-matting-background"
        >
          {SMART_MATTING_BACKGROUND_COLORS.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={item === backgroundColor}
              className={`${styles.segmentBtn} ${item === backgroundColor ? styles.segmentBtnActive : ''}`}
              data-testid={`smart-matting-background-${item}`}
              disabled={readOnly}
              title={`MP4 纯色背景：${SMART_MATTING_BACKGROUND_COLOR_LABELS[item]}`}
              onClick={guarded(readOnly, () => onBackgroundColorChange(item))}
            >
              {SMART_MATTING_BACKGROUND_COLOR_LABELS[item]}
            </button>
          ))}
        </div>
      )}
      <span className={styles.freeBadge} title="本期免费" data-testid="smart-matting-free-badge">
        <Zap size={12} strokeWidth={2} />
        <span>0</span>
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="smart-matting-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '发送智能抠像任务'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
