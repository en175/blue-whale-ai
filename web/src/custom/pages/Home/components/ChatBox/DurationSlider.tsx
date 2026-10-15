import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './DurationSlider.module.css';
import {
  HOME_DURATION_MAX,
  HOME_DURATION_MIN,
  HOME_DURATION_STEP,
  parseDurationInput,
  ratioFromValue,
  snapDuration,
  springSettled,
  stepSpring,
  valueFromPointer,
  valueFromRatio,
} from './durationSliderModel';

type DurationSliderProps = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

export default function DurationSlider({
  value,
  onChange,
  min = HOME_DURATION_MIN,
  max = HOME_DURATION_MAX,
  step = HOME_DURATION_STEP,
}: DurationSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const visualRef = useRef(ratioFromValue(value, min, max));
  const velocityRef = useRef(0);
  const targetRef = useRef(visualRef.current);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const lastCommittedRef = useRef(value);
  const [visualRatio, setVisualRatio] = useState(visualRef.current);
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  onChangeRef.current = onChange;

  const commitSnapped = useCallback(
    (raw: number) => {
      const next = snapDuration(raw, min, max, step);
      if (next === lastCommittedRef.current) return;
      lastCommittedRef.current = next;
      onChangeRef.current(next);
    },
    [min, max, step],
  );

  const stopLoop = useCallback(() => {
    if (rafRef.current == null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = 0;
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;

    const tick = (ts: number) => {
      const prevTs = lastTsRef.current;
      lastTsRef.current = ts;
      const dt = prevTs === 0 ? 1 / 60 : Math.min(0.032, (ts - prevTs) / 1000);
      const next = stepSpring(visualRef.current, velocityRef.current, targetRef.current, dt);
      visualRef.current = next.position;
      velocityRef.current = next.velocity;
      setVisualRatio(next.position);
      if (draggingRef.current) {
        commitSnapped(valueFromRatio(next.position, min, max));
      }

      if (
        draggingRef.current ||
        !springSettled(next.position, next.velocity, targetRef.current)
      ) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      visualRef.current = targetRef.current;
      velocityRef.current = 0;
      setVisualRatio(targetRef.current);
      rafRef.current = null;
      lastTsRef.current = 0;
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [commitSnapped, min, max]);

  useEffect(() => () => stopLoop(), [stopLoop]);

  useEffect(() => {
    if (draggingRef.current) return;
    lastCommittedRef.current = value;
    const nextRatio = ratioFromValue(value, min, max);
    if (
      Math.abs(targetRef.current - nextRatio) < 1e-6 &&
      springSettled(visualRef.current, velocityRef.current, nextRatio)
    ) {
      return;
    }
    targetRef.current = nextRatio;
    startLoop();
  }, [value, min, max, startLoop]);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const aimAt = useCallback(
    (clientX: number, snapTarget: boolean) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const raw = valueFromPointer(clientX, rect.left, rect.width, min, max);
      const aimed = snapTarget ? snapDuration(raw, min, max, step) : raw;
      targetRef.current = ratioFromValue(aimed, min, max);
      if (snapTarget) commitSnapped(aimed);
      startLoop();
    },
    [commitSnapped, min, max, step, startLoop],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    aimAt(event.clientX, false);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    aimAt(event.clientX, false);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    aimAt(event.clientX, true);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - step;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + step;
    if (event.key === 'Home') next = min;
    if (event.key === 'End') next = max;
    if (next == null) return;
    event.preventDefault();
    const snapped = snapDuration(next, min, max, step);
    lastCommittedRef.current = snapped;
    onChange(snapped);
  };

  const commitDraft = () => {
    setEditing(false);
    const parsed = parseDurationInput(draft, min, max, step);
    if (parsed == null) {
      setDraft(String(value));
      return;
    }
    lastCommittedRef.current = parsed;
    onChange(parsed);
    setDraft(String(parsed));
  };

  const percent = `${clampPercent(visualRatio) * 100}%`;

  return (
    <div className={styles.row}>
      <div className={styles.slider}>
        <div
          ref={trackRef}
          className={styles.hit}
          role="slider"
          tabIndex={0}
          aria-label="时长"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={`${value}s`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={onKeyDown}
        >
          <div className={styles.track}>
            <div className={styles.fill} style={{ width: percent }} />
            <div className={styles.thumb} style={{ left: percent }} />
          </div>
        </div>
      </div>
      <div className={styles.field}>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          aria-label="时长秒数"
          value={editing ? draft : String(value)}
          onFocus={() => {
            setEditing(true);
            setDraft(String(value));
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
            }
          }}
        />
        <span className={styles.unit}>s</span>
      </div>
    </div>
  );
}

function clampPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}
