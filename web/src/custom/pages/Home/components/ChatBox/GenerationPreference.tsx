import { useEffect, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import styles from './index.module.css';

export interface PreferenceOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface PreferenceField {
  key: string;
  label: string;
  options: PreferenceOption[];
  value: string;
  onChange: (value: string) => void;
}

export interface PreferenceToggle {
  key: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export default function GenerationPreference({
  summary,
  fields,
  toggles = [],
  hint,
}: {
  summary: string;
  fields: PreferenceField[];
  toggles?: PreferenceToggle[];
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className={styles.summary}>{summary}</span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="生成偏好">
          <strong className={styles.heading}>生成偏好</strong>
          {fields.map((field) => (
            <div key={field.key} className={styles.field}>
              <span className={styles.fieldLabel}>{field.label}</span>
              <div className={styles.options}>
                {field.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={styles.option}
                    aria-pressed={field.value === option.value}
                    disabled={option.disabled}
                    title={option.disabled ? '当前模型不支持此选项' : undefined}
                    onClick={() => field.onChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {toggles.map((toggle) => (
            <div key={toggle.key} className={styles.field}>
              <span className={styles.fieldLabel}>{toggle.label}</span>
              <div className={styles.options}>
                <button
                  type="button"
                  className={styles.option}
                  aria-pressed={toggle.value}
                  onClick={() => toggle.onChange(true)}
                >
                  开启
                </button>
                <button
                  type="button"
                  className={styles.option}
                  aria-pressed={!toggle.value}
                  onClick={() => toggle.onChange(false)}
                >
                  关闭
                </button>
              </div>
            </div>
          ))}
          {hint && <p className={styles.hint}>{hint}</p>}
        </div>
      )}
    </div>
  );
}
