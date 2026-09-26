import type { ReactNode } from 'react';
import styles from './index.module.css';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

interface AlertProps {
  tone?: AlertTone;
  /** 可选标题。一句话能说清就别加——标题加正文两段话反而没人读完 */
  title?: ReactNode;
  /** 右侧动作（重试、去设置等） */
  action?: ReactNode;
  children: ReactNode;
}

const TONE_CLASS: Record<AlertTone, string> = {
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
};

/**
 * 页面级提示条。
 *
 * <p>用它而不是 `<Card>{错误文案}</Card>`：卡片是**内容容器**，把一句报错塞进去，
 * 它在视觉上和「这块数据长这样」没有区别——用户会以为那是页面的一部分而不是
 * 「刚才那个操作失败了」。提示条有配色、有边界，一眼能看出是异常状态。
 *
 * <p>⚠️ `tone="danger"` 用于**操作失败**（用户刚点了什么），`tone="info"` 用于
 * 说明性文字。全用 danger 会让页面永远像出了事故。
 */
export default function Alert({ tone = 'info', title, action, children }: AlertProps) {
  return (
    <div className={`${styles.alert} ${TONE_CLASS[tone]}`} role="status">
      <div className={styles.body}>
        {title !== undefined && <div className={styles.title}>{title}</div>}
        <div className={styles.text}>{children}</div>
      </div>
      {action !== undefined && <div className={styles.action}>{action}</div>}
    </div>
  );
}
