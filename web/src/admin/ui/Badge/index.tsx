import type { ReactNode } from 'react';
import styles from './index.module.css';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: styles.neutral,
  accent: styles.accent,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
};

export default function Badge({ tone = 'neutral', dot = false, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${TONE_CLASS[tone]}`}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
