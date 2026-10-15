import type { AriaRole, ReactNode } from 'react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

export interface EmptyProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  role?: AriaRole;
  'aria-label'?: string;
}

export default function Empty({
  title,
  description,
  action,
  icon,
  className,
  role,
  'aria-label': ariaLabel,
}: EmptyProps) {
  return (
    <div className={joinClassNames(styles.root, className)} role={role} aria-label={ariaLabel}>
      {icon ? <div className={styles.icon}>{icon}</div> : null}
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
