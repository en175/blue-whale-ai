import type { ReactNode } from 'react';
import styles from './index.module.css';

interface CardProps {
  title?: ReactNode;
  extra?: ReactNode;
  padded?: boolean;
  children: ReactNode;
}

export default function Card({ title, extra, padded = true, children }: CardProps) {
  const hasHead = title !== undefined || extra !== undefined;

  return (
    <div className={styles.card}>
      {hasHead && (
        <div className={styles.head}>
          {title !== undefined && <div className={styles.title}>{title}</div>}
          {extra !== undefined && <div className={styles.extra}>{extra}</div>}
        </div>
      )}
      <div className={padded ? styles.body : undefined}>{children}</div>
    </div>
  );
}
