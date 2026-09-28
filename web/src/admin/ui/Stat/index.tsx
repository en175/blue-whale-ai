import type { ReactNode } from 'react';
import styles from './index.module.css';

export type StatTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

interface StatProps {
  label: ReactNode;
  /** 数值。已经是给人看的字符串（含单位/千分位），组件不再做格式化 */
  value: ReactNode;
  /** 数字下方的补充说明（同比、说明文字） */
  hint?: ReactNode;
  tone?: StatTone;
  /** 右上角图标（lucide 组件） */
  icon?: ReactNode;
}

const TONE_CLASS: Record<StatTone, string> = {
  accent: styles.accent,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  neutral: styles.neutral,
};

/**
 * 指标卡 —— 一个数 + 它的名字。
 *
 * <p>{@code value} 收的是**已经格式化好的字符串**而不是 number：单位（积分 / 笔 / 人）
 * 与千分位规则是各页面自己的业务知识，塞进组件就得给每个页面开一个格式化分支。
 * 组件只负责「怎么把这个数显示得体面」。
 *
 * <p>色只用于强调，不承载语义。用颜色区分「好/坏」的地方（例如消费为负）
 * 请在调用处显式选 {@code tone}，别指望组件猜。
 */
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
