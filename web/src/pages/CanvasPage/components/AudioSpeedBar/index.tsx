import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowUp, X, Zap } from 'lucide-react';
import {
  AUDIO_SPEED_MAX_SPEED,
  AUDIO_SPEED_MIN_SPEED,
  AUDIO_SPEED_SLIDER_MAX_POS,
  AUDIO_SPEED_SLIDER_MIN_POS,
  AUDIO_SPEED_STEP,
  posToSpeed,
  roundAudioSpeed,
  speedToPos,
} from '@lib/contracts/audio-speed';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import { audioSpeedLabel } from '../../audioSpeed';
import styles from './index.module.css';

interface AudioSpeedBarProps {
  onClose: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onSend: () => void;
  submitting?: boolean;
  anchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

const SPEED_TICKS: ReadonlyArray<{ label: string; speed: number; tone?: 'origin' | 'first' | 'last' }> = [
  { label: '0.1x', speed: 0.1, tone: 'first' },
  { label: '0.5x', speed: 0.5 },
  { label: '1.0x 原速', speed: 1, tone: 'origin' },
  { label: '2.0x', speed: 2 },
  { label: '4.0x', speed: 4, tone: 'last' },
];

export default function AudioSpeedBar({
  onClose,
  speed,
  onSpeedChange,
  onSend,
  submitting,
  anchor, dragHidden,
}: AudioSpeedBarProps) {
  const readOnly = submitting === true;

  const canSend = !readOnly && speed !== 1;
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  const pos = speedToPos(speed);

  const onSliderKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (readOnly) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? AUDIO_SPEED_STEP : -AUDIO_SPEED_STEP;
      const next = Math.min(
        AUDIO_SPEED_MAX_SPEED,
        Math.max(AUDIO_SPEED_MIN_SPEED, roundAudioSpeed(speed + delta)),
      );
      if (next !== speed) onSpeedChange(next);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className={`${styles.sendBar} ${anchor ? styles.sendBarFollow : ''}`}
      style={anchoredOverlayStyle(anchor, dragHidden)}
      data-gen-panel-territory
      data-testid="audio-speed-send-bar"
    >
      <button
        type="button"
        className={styles.closeBtn}
        data-testid="audio-speed-close"
        title="退出调速（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.title}>调速</span>
      {}
      <div className={styles.sliderBox}>
        <input
          type="range"
          className={styles.slider}
          min={AUDIO_SPEED_SLIDER_MIN_POS}
          max={AUDIO_SPEED_SLIDER_MAX_POS}
          step={1}
          value={pos}
          disabled={readOnly}
          style={{ '--fill': `${pos / 10}%` } as CSSProperties}
          data-testid="audio-speed-slider"
          aria-label="播放倍速"
          onChange={(e) => onSpeedChange(posToSpeed(parseInt(e.target.value, 10)))}
          onKeyDown={onSliderKeyDown}
        />
        {}
        <span className={styles.notch} aria-hidden />
        <div className={styles.ticks} aria-hidden>
          {SPEED_TICKS.map((tick) => (
            <span
              key={tick.label}
              className={`${styles.tick} ${tick.tone ? styles[tick.tone] : ''}`}
              style={{ left: `${speedToPos(tick.speed) / 10}%` }}
              data-testid={`audio-speed-tick-${tick.tone ?? tick.speed}`}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      {}
      <span className={styles.value} data-testid="audio-speed-value">
        {audioSpeedLabel(speed)}
      </span>
      {}
      <span className={styles.free} title="本期免费" data-testid="audio-speed-free">
        <Zap size={11} fill="currentColor" strokeWidth={0} />
        0
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
        data-testid="audio-speed-send-btn"
        disabled={readOnly}
        title={
          readOnly
            ? '正在发送，请稍候'
            : canSend
              ? `生成 ${audioSpeedLabel(speed)} 调速音频`
              : '滑离原速位后可发送'
        }
        onClick={guarded(readOnly || speed === 1, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
