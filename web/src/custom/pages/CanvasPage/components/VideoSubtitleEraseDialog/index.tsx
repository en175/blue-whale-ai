import { ArrowUp, HelpCircle, Redo2, RotateCcw, Square, Undo2, X, Zap } from 'lucide-react';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import type { VideoSubtitleEraseMode } from '../../videoSubtitleErase';
import styles from './index.module.css';

interface VideoSubtitleEraseDialogProps {
  mode: VideoSubtitleEraseMode;
  onClose: () => void;
  onSend: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  boxLimitReached: boolean;
  submitting?: boolean;
  sendBlockedReason: string | null;
  sendBarAnchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function VideoSubtitleEraseDialog({
  mode,
  onClose,
  onSend,
  canUndo,
  canRedo,
  canReset,
  onUndo,
  onRedo,
  onReset,
  boxLimitReached,
  submitting,
  sendBlockedReason,
  sendBarAnchor, dragHidden,
}: VideoSubtitleEraseDialogProps) {
  const readOnly = submitting === true;
  const boxMode = mode === 'box';

  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };


  const sendDisabled = readOnly || sendBlockedReason != null;
  const sendTitle = readOnly
    ? '正在发送，请稍候'
    : sendBlockedReason
      ?? (boxMode
        ? '发送去字幕任务：擦除所拉检测框内的字幕（输出最高 1080P）'
        : '发送去字幕任务：自动擦除画面下半字幕（输出最高 1080P）');

  return (
    <div
      className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
      style={anchoredOverlayStyle(sendBarAnchor, dragHidden)}
      data-gen-panel-territory
      data-testid="subtitle-erase-send-bar"
    >
      <button
        type="button"
        className={styles.toolBtn}
        data-testid="subtitle-erase-close"
        title="退出去字幕（未发送的检测框将被丢弃）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.barTitle} data-testid="subtitle-erase-title">
        {boxMode ? '框选擦除' : '智能擦除'}
      </span>
      {boxMode && (
        <>
          {}
          <span
            className={styles.helpHint}
            data-testid="subtitle-erase-help"
            title="拉框圈出要擦除的字幕区域：框内文字被无痕擦除，检测框对全片生效，最多 20 个"
          >
            <HelpCircle size={14} strokeWidth={2} />
          </span>
          <span className={styles.divider} />
          <button
            type="button"
            className={`${styles.toolBtn} ${styles.toolBtnActive}`}
            data-testid="subtitle-erase-tool-box"
            aria-pressed="true"
            disabled={readOnly || boxLimitReached}
            title={boxLimitReached ? '检测框已达 20 个上限，撤销后可再拉' : '框选：在画面上拉矩形框指定检测区域（最多 20 个）'}
          >
            <Square size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            data-testid="subtitle-erase-undo"
            disabled={!canUndo || readOnly}
            title={canUndo ? '撤销最近一步（落框或重置）' : '没有可撤销的操作'}
            onClick={guarded(!canUndo || readOnly, onUndo)}
          >
            <Undo2 size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            data-testid="subtitle-erase-redo"
            disabled={!canRedo || readOnly}
            title={canRedo ? '重做最近一步（落框或重置）' : '没有可重做的操作'}
            onClick={guarded(!canRedo || readOnly, onRedo)}
          >
            <Redo2 size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            data-testid="subtitle-erase-reset"
            disabled={!canReset || readOnly}
            title={canReset ? '清空全部检测框（可撤销）' : '没有可清空的检测框'}
            onClick={guarded(!canReset || readOnly, onReset)}
          >
            <RotateCcw size={14} strokeWidth={2} />
          </button>
        </>
      )}
      <span className={styles.divider} />
      <span className={styles.freeBadge} title="本期免费" data-testid="subtitle-erase-free-badge">
        <Zap size={12} strokeWidth={2} />
        <span>0</span>
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!sendDisabled ? styles.sendBtnActive : ''}`}
        data-testid="subtitle-erase-send-btn"
        disabled={sendDisabled}
        title={sendTitle}
        onClick={guarded(sendDisabled, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
