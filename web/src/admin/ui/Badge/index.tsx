/* ============================================
 * Badge —— 状态标签
 *
 * 五个调子：neutral / accent / success / warning / danger。
 * **一律用柔和底 + 深字，不用实心**——实心标签一多，一屏全是色块，页面立刻花。
 * ============================================ */
import type { ReactNode } from 'react';
import styles from './index.module.css';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  tone?: BadgeTone;
  /** 前置圆点。用色点表达状态比只用底色更清楚（色盲友好） */
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
