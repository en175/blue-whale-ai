import type { ReactNode } from 'react';
import styles from './index.module.css';

interface ChipProps {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export default function Chip({ active = false, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`${styles.chip} ${active ? styles.active : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
