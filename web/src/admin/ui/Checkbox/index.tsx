import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
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
  return (
    <CheckboxPrimitive.Root
      checked={indeterminate ? 'indeterminate' : checked}
      onCheckedChange={(next) => onChange(next === true)}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        onChange(indeterminate ? true : !checked);
      }}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-label={label === undefined ? ariaLabel : undefined}
      className={`${styles.row} ${disabled ? styles.disabled : ''}`}
    >
      <span className={styles.box} />
      {label !== undefined && <span className={styles.label}>{label}</span>}
    </CheckboxPrimitive.Root>
  );
}
