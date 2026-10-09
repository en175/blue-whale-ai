import type { ReactNode } from 'react';
import styles from './index.module.css';

interface ToolbarProps {
  children: ReactNode;
  actions?: ReactNode;
}

export default function Toolbar({ children, actions }: ToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>{children}</div>
      {actions !== undefined && (
        <>
          <div className={styles.spacer} />
          <div className={styles.actions}>{actions}</div>
        </>
      )}
    </div>
  );
}
