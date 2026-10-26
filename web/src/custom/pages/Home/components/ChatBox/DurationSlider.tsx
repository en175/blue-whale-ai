import { useEffect, useState } from 'react';
import DragSlider from '@/custom/components/DragSlider';
import styles from './DurationSlider.module.css';
import {
  HOME_DURATION_MAX,
  HOME_DURATION_MIN,
  HOME_DURATION_STEP,
  parseDurationInput,
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
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const commitDraft = () => {
    setEditing(false);
    const parsed = parseDurationInput(draft, min, max, step);
    if (parsed == null) {
      setDraft(String(value));
      return;
    }
    onChange(parsed);
    setDraft(String(parsed));
  };

  return (
    <div className={styles.row}>
      <DragSlider
        className={styles.slider}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        ariaLabel="时长"
        ariaValueText={`${value}s`}
      />
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
