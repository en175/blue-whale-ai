import type { ReactNode } from 'react';
import Hint from '../Hint';
import styles from './index.module.css';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  info?: ReactNode;
  children: ReactNode;
}

export default function Field({ label, hint, info, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.label}>
        {label}
        {info !== undefined && <Hint>{info}</Hint>}
      </div>
      {children}
      {hint !== undefined && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
