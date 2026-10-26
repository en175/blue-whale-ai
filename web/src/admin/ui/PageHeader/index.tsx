import type { ReactNode } from 'react';
import styles from './index.module.css';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
}

export default function PageHeader({ title, subtitle, extra }: PageHeaderProps) {
  return (
    <header className={styles.head}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle !== undefined && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {extra !== undefined && <div className={styles.extra}>{extra}</div>}
    </header>
  );
}
