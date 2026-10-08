import type { ReactNode } from 'react';
import styles from './index.module.css';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  'aria-label'?: string;
}

export default function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  indeterminate = false,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const toggle = () => {
    if (disabled) return;
    onChange(!checked);
  };

  const box = (
    <span
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label === undefined ? ariaLabel : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={`${styles.box} ${checked || indeterminate ? styles.on : ''} ${
        indeterminate ? styles.mixed : ''
      }`}
      onClick={(e) => {
        e.preventDefault();
        if (label === undefined) toggle();
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {}
    </span>
  );

  if (label === undefined) return box;

  return (
    <label
      className={`${styles.row} ${disabled ? styles.disabled : ''}`}
      onClick={(e) => {
        e.preventDefault();
        toggle();
      }}
    >
      {box}
      <span className={styles.label}>{label}</span>
    </label>
  );
}
