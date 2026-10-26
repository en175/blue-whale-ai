import type { ReactNode } from 'react';
import styles from './index.module.css';

interface TableProps {
  children: ReactNode;
  fixed?: boolean;
}

export default function Table({ children, fixed = false }: TableProps) {
  return (
    <div className={styles.wrap}>
      <table className={fixed ? `${styles.table} ${styles.fixed}` : styles.table}>{children}</table>
    </div>
  );
}
