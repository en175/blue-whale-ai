import type { ReactNode } from 'react';
import styles from './index.module.css';

export default function Page({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}
