import { useEffect, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import DragSlider from '@/custom/components/DragSlider';
import RatioGroup from '@/custom/components/RatioGroup';
import Select from '@/custom/components/Select';
import styles from './GenerationPreference.module.css';

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
  numeric?: boolean;
}

export interface PreferenceToggle {
  key: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}

function durationRangeOf(field: PreferenceField) {
  const values = field.options
    .filter((option) => !option.disabled)
    .map((option) => Number(option.value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (values.length < 2) return null;
  const steps = values.slice(1).map((value, index) => value - values[index]);
  const step = Math.min(...steps);
  return { min: values[0], max: values[values.length - 1], step: step > 0 ? step : 1, values };
}

function optionList(field: PreferenceField) {
  return field.options.map((option) => ({
    value: option.value,
    label: option.label,
    disabled: option.disabled,
  }));
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

  const modelField = fields.find((field) => field.key === 'model');
  const sizeField = fields.find((field) => field.key === 'resolution');
  const ratioField = fields.find((field) => field.key === 'ratio');
  const durationField = fields.find((field) => field.key === 'duration' && field.numeric);
  const plainFields = fields.filter(
    (field) => field !== modelField && field !== sizeField && field !== ratioField && field !== durationField,
  );

  const durationRange = durationField ? durationRangeOf(durationField) : null;
  const autoDuration = durationField?.options.find((option) => option.value === '-1' && !option.disabled);
  const durationValue = durationField ? Number(durationField.value) : 0;
  const durationText = durationField
    ? durationValue === -1
      ? '自动'
      : `${durationValue}s`
    : '';
  const sliderValue =
    durationRange && Number.isFinite(durationValue) && durationValue >= 0
      ? Math.min(Math.max(durationValue, durationRange.min), durationRange.max)
      : (durationRange?.min ?? 0);

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
        <div className={styles.panel} role="dialog" aria-label="生成偏好">
          <button className={styles.close} onClick={() => setOpen(false)} title="关闭">
            <X size={14} strokeWidth={2} />
          </button>

          {(modelField || sizeField) && <span className={styles.label}>模型与质量</span>}
          {(modelField || sizeField) && (
            <div className={styles.row}>
              {modelField && (
                <Select
                  value={modelField.value}
                  onChange={modelField.onChange}
                  size="md"
                  side="top"
                  placeholder="选择模型"
                  ariaLabel="选择模型"
                  options={optionList(modelField)}
                />
              )}
              {sizeField && (
                <Select
                  value={sizeField.value}
                  onChange={sizeField.onChange}
                  size="md"
                  side="top"
                  placeholder="选择分辨率"
                  ariaLabel="选择分辨率"
                  options={optionList(sizeField)}
                />
              )}
            </div>
          )}

          {plainFields.map((field) => (
            <div key={field.key} className={styles.field}>
              <span className={styles.label}>{field.label}</span>
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

          {durationField && durationRange && (
            <>
              <div className={styles.durationHead}>
                <span className={styles.label}>时长</span>
                <span className={styles.durationValue}>{durationText}</span>
              </div>
              {autoDuration && (
                <button
                  type="button"
                  className={styles.auto}
                  aria-pressed={durationValue === -1}
                  onClick={() => durationField.onChange(durationValue === -1 ? String(durationRange.min) : '-1')}
                >
                  自动，由模型选择时长
                </button>
              )}
              <DragSlider
                className={styles.slider}
                min={durationRange.min}
                max={durationRange.max}
                step={durationRange.step}
                value={sliderValue}
                disabled={durationValue === -1}
                ariaLabel="时长"
                ariaValueText={durationText}
                onChange={(next) => durationField.onChange(String(next))}
              />
              <div className={styles.ticks}>
                {durationRange.values.map((value) => (
                  <span
                    key={value}
                    className={`${styles.tick} ${value === sliderValue ? styles.tickActive : ''}`}
                  />
                ))}
              </div>
              <div className={styles.range}>
                <span>{durationRange.min}s</span>
                <span>{durationRange.max}s</span>
              </div>
            </>
          )}

          {ratioField && (
            <>
              <span className={styles.label}>宽高比</span>
              <RatioGroup
                className={styles.ratio}
                variant="tiles"
                value={ratioField.value}
                ariaLabel="宽高比"
                onChange={ratioField.onChange}
                options={optionList(ratioField)}
              />
            </>
          )}

          {toggles.map((toggle) => (
            <div key={toggle.key}>
              <span className={styles.label}>{toggle.label}</span>
              <div className={styles.toggleRow}>
                <span className={styles.hint}>{toggle.hint ?? toggle.label}</span>
                <button
                  type="button"
                  className={`${styles.switch} ${toggle.value ? styles.switchOn : ''}`}
                  role="switch"
                  aria-checked={toggle.value}
                  aria-label={toggle.label}
                  onClick={() => toggle.onChange(!toggle.value)}
                >
                  <span className={styles.switchKnob} />
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
