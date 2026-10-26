import * as Slider from '@radix-ui/react-slider';
import { useCallback } from 'react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';
import { snapValue, type SliderScale } from './dragSliderModel';

const DRAG_STEPS = 1000;

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
  scale?: SliderScale;
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
  scale,
  onKeyDown,
}: DragSliderProps) {
  const sliderMax = max < min ? min : max;
  const sliderValue = scale
    ? Math.round(scale.ratioFromValue(Math.min(Math.max(value, min), sliderMax)) * DRAG_STEPS)
    : snapValue(value, min, sliderMax, step);

  const commit = useCallback(
    (raw: number) => {
      if (disabled) return;
      const next = scale
        ? scale.stepValue(scale.valueFromRatio(raw / DRAG_STEPS))
        : snapValue(raw, min, sliderMax, step);
      if (next === value) return;
      onChange(next);
    },
    [disabled, min, onChange, scale, sliderMax, step, value],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
  };

  return (
    <div className={joinClassNames(styles.root, className)}>
      <input
        type="range"
        className={styles.native}
        min={scale ? 0 : min}
        max={scale ? DRAG_STEPS : sliderMax}
        step={scale ? 1 : step}
        value={sliderValue}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        data-testid={testId}
        onChange={(event) => commit(Number(event.target.value))}
        onKeyDown={handleKeyDown}
      />
      <Slider.Root
        className={styles.hit}
        min={scale ? 0 : min}
        max={scale ? DRAG_STEPS : sliderMax}
        step={scale ? 1 : step}
        value={[sliderValue]}
        disabled={disabled}
        onValueChange={(next) => {
          const raw = next[0];
          if (raw == null || raw === sliderValue) return;
          commit(raw);
        }}
        onKeyDown={handleKeyDown}
      >
        <Slider.Track className={styles.track}>
          <Slider.Range className={styles.fill} />
        </Slider.Track>
        <Slider.Thumb
          className={styles.thumb}
          aria-label={ariaLabel}
          aria-valuetext={ariaValueText}
        />
      </Slider.Root>
    </div>
  );
}
