import type { ReactNode } from 'react';
import styles from './index.module.css';

interface EmptyProps {
  message: string;
  extra?: ReactNode;
}

export default function Empty({ message, extra }: EmptyProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.message}>{message}</p>
      {extra !== undefined && <div className={styles.extra}>{extra}</div>}
    </div>
  );
}
