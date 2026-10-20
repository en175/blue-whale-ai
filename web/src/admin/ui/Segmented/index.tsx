import styles from './index.module.css';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedProps<T extends string = string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export default function Segmented<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className={styles.group} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        const off = disabled || option.disabled === true;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-disabled={off || undefined}
            disabled={off}
            className={`${styles.option} ${active ? styles.active : ''}`}
            onClick={() => {
              if (!off) onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
