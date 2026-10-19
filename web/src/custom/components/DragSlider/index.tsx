import { useCallback, useEffect, useRef, useState } from 'react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';
import {
  clampPercent,
  ratioFromValue,
  snapValue,
  springSettled,
  stepSpring,
  valueFromPointer,
  valueFromRatio,
} from './dragSliderModel';

export interface DragSliderProps {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  ariaLabel: string;
  ariaValueText?: string;
  testId?: string;
  className?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export default function DragSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  ariaLabel,
  ariaValueText,
  testId,
  className,
  onKeyDown,
}: DragSliderProps) {
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

  onChangeRef.current = onChange;

  const commitSnapped = useCallback(
    (raw: number) => {
      const next = snapValue(raw, min, max, step);
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

  const aimAt = useCallback(
    (clientX: number, snapTarget: boolean) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const raw = valueFromPointer(clientX, rect.left, rect.width, min, max);
      const aimed = snapTarget ? snapValue(raw, min, max, step) : raw;
      targetRef.current = ratioFromValue(aimed, min, max);
      if (snapTarget) commitSnapped(aimed);
      startLoop();
    },
    [commitSnapped, min, max, step, startLoop],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    aimAt(event.clientX, false);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || disabled) return;
    event.stopPropagation();
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - step;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + step;
    if (event.key === 'Home') next = min;
    if (event.key === 'End') next = max;
    if (next == null) return;
    event.preventDefault();
    const snapped = snapValue(next, min, max, step);
    lastCommittedRef.current = snapped;
    onChange(snapped);
  };

  const commitFromNative = (raw: number) => {
    if (disabled) return;
    const snapped = snapValue(raw, min, max, step);
    lastCommittedRef.current = snapped;
    onChange(snapped);
    targetRef.current = ratioFromValue(snapped, min, max);
    startLoop();
  };

  const percent = `${clampPercent(visualRatio) * 100}%`;

  return (
    <div className={joinClassNames(styles.root, className)}>
      <input
        type="range"
        className={styles.native}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        data-testid={testId}
        onChange={(event) => commitFromNative(Number(event.target.value))}
        onKeyDown={handleKeyDown}
      />
      <div
        ref={trackRef}
        className={styles.hit}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={ariaValueText}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: percent }} />
          <div className={styles.thumb} style={{ left: percent }} />
        </div>
      </div>
    </div>
  );
}
