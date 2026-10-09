import type { ReactNode } from 'react';
import styles from './index.module.css';

interface BarProps {
  label: ReactNode;
  value: ReactNode;
  ratio: number;
}

const PERCENT_DIGITS = 1;

export default function Bar({ label, value, ratio }: BarProps) {
  const safeRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.meta}>
          <span className={styles.value}>{value}</span>
          {}
          <span className={styles.percent}>{(safeRatio * 100).toFixed(PERCENT_DIGITS)}%</span>
        </span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${safeRatio * 100}%` }} />
      </div>
    </div>
  );
}
