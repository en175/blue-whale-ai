import type { ReactNode } from 'react';
import styles from './index.module.css';

export type StatTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  icon?: ReactNode;
}

const TONE_CLASS: Record<StatTone, string> = {
  accent: styles.accent,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  neutral: styles.neutral,
};

export default function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: StatProps) {
  return (
    <div className={styles.stat}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {icon !== undefined && (
          <span className={`${styles.iconBox} ${TONE_CLASS[tone]}`} aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className={styles.value}>{value}</div>
      {hint !== undefined && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
