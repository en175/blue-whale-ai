/* ============================================
 * Chip —— 可点选的胶囊筛选片
 *
 * 与 Button 分开是因为**语义不同**：Button 是「执行一个动作」，Chip 是「切换一个过滤条件」。
 * 两者共用一套样式的话，调用方只能靠传 variant 硬凑，久了就分不清哪个是哪个。
 *
 * 选中态用「淡底 + 强调色描边」，不用实心——一屏多个实心片会很吵。
 * ============================================ */
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
