import type { ReactNode } from 'react';
import styles from './index.module.css';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

const TONE_CLASS: Record<AlertTone, string> = {
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
};

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
