import type { HTMLAttributes } from 'react';
import { joinClassNames } from '@/app/utils/class-names';
import styles from './index.module.css';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  active?: boolean;
}

export default function Skeleton({ active = true, className, ...props }: SkeletonProps) {
  return (
    <div
      {...props}
      className={joinClassNames(styles.skeleton, active && styles.active, className)}
      aria-hidden="true"
    />
  );
}
