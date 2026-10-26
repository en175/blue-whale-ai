import type { ReactNode } from 'react';

import styles from './index.module.css';

export interface MetaItem {
  label: ReactNode;
  value: ReactNode;
}

interface MetaRowProps {
  items: MetaItem[];
  tone?: 'plain' | 'sunken';
}

export default function MetaRow({ items, tone = 'plain' }: MetaRowProps) {
  return (
    <dl className={tone === 'sunken' ? `${styles.row} ${styles.sunken}` : styles.row}>
      {items.map((item, index) => (
        <div key={index} className={styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
