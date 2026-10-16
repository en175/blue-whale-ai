import { useCallback, useRef } from 'react';
import {
  audioTrimDurationLabel,
  audioTrimTimePercent,
  clampAudioTrimPlayhead,
  dragAudioTrimHandleEnd,
  dragAudioTrimHandleStart,
  type AudioTrimSelection,
} from '../../tools/audio/audioTrimGeometry';
import styles from './AudioTrimOverlay.module.css';

export interface AudioTrimOverlayProps {
  selection: AudioTrimSelection;
  duration: number;
  onSelectionChange: (selection: AudioTrimSelection) => void;
  onSeekStart: () => void;
  onSeek: (time: number) => void;
  onSeekEnd: (time: number) => void;
}

type HandleSide = 'start' | 'end';

export default function AudioTrimOverlay({
  selection,
  duration,
  onSelectionChange,
  onSeekStart,
  onSeek,
  onSeekEnd,
}: AudioTrimOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const handleDragRef = useRef<HandleSide | null>(null);
  const seekingRef = useRef(false);

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const el = rootRef.current;
      if (!el || !(duration > 0)) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      return Math.min(Math.max(ratio, 0), 1) * duration;
    },
    [duration],
  );

  const onHandleDown = (side: HandleSide) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    handleDragRef.current = side;
  };

  const onRootPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const side = handleDragRef.current;
    if (side) {
      event.stopPropagation();
      const time = timeFromEvent(event.clientX);
      const next =
        side === 'start'
          ? dragAudioTrimHandleStart(time, selection)
          : dragAudioTrimHandleEnd(time, selection, duration);
      onSelectionChange(next);
      return;
    }
    if (seekingRef.current) {
      event.stopPropagation();
      onSeek(clampAudioTrimPlayhead(timeFromEvent(event.clientX), selection));
    }
  };

  const onRootPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (handleDragRef.current) {
      handleDragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
      return;
    }
    if (seekingRef.current) {
      seekingRef.current = false;
      onSeekEnd(clampAudioTrimPlayhead(timeFromEvent(event.clientX), selection));
    }
  };

  const onSelectionDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSeekStart();
    seekingRef.current = true;
    onSeek(clampAudioTrimPlayhead(timeFromEvent(event.clientX), selection));
  };

  const swallow = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
  };

  const leftPct = audioTrimTimePercent(selection.start, duration);
  const widthPct = audioTrimTimePercent(selection.end - selection.start, duration);

  return (
    <div
      ref={rootRef}
      className={`nodrag nopan ${styles.overlay}`}
      data-testid="audio-trim-overlay"
      data-gen-panel-territory
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={onRootPointerUp}
      onClick={(event) => event.stopPropagation()}
    >
      {}
      <div className={styles.dim} style={{ left: 0, width: `${leftPct}%` }} onPointerDown={swallow} />
      <div
        className={styles.dim}
        style={{ left: `${leftPct + widthPct}%`, right: 0 }}
        onPointerDown={swallow}
      />
      {}
      <div
        className={styles.selection}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        data-testid="audio-trim-selection"
        onPointerDown={onSelectionDown}
      >
        <span className={styles.pill} data-testid="audio-trim-pill">
          {audioTrimDurationLabel(selection)}
        </span>
      </div>
      {}
      <div
        className={styles.handle}
        style={{ left: `${leftPct}%` }}
        data-testid="audio-trim-handle-start"
        onPointerDown={onHandleDown('start')}
      />
      <div
        className={styles.handle}
        style={{ left: `${leftPct + widthPct}%` }}
        data-testid="audio-trim-handle-end"
        onPointerDown={onHandleDown('end')}
      />
    </div>
  );
}
