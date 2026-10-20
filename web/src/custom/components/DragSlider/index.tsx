import * as Slider from '@radix-ui/react-slider';
import { useCallback } from 'react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';
import { snapValue } from './dragSliderModel';

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
  const commit = useCallback(
    (raw: number) => {
      if (disabled) return;
      const next = snapValue(raw, min, max, step);
      if (next === value) return;
      onChange(next);
    },
    [disabled, max, min, onChange, step, value],
  );

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
        onChange={(event) => commit(Number(event.target.value))}
      />
      <Slider.Root
        className={styles.hit}
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onValueChange={(next) => commit(next[0] ?? value)}
        onKeyDown={onKeyDown}
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
