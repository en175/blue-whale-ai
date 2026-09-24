import type { ReactNode } from 'react';
import styles from './index.module.css';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 有 label 时整行可点；没有则只点方框本身（所以无 label 时必须给 aria-label） */
  label?: ReactNode;
  disabled?: boolean;
  /** 全选这种「部分选中」的中间态 */
  indeterminate?: boolean;
  'aria-label'?: string;
}

/**
 * 复选框。
 *
 * <p>⚠️ **不用原生 `<input type="checkbox">`**：原生控件的外观由操作系统决定，
 * 而管理端是浅色固定主题——在把系统切到深色的机器上，它会渲染成一个深色方块，
 * 和周围格格不入。这与 `Select` 不用原生 `<select>` 是同一个理由。
 *
 * <p>用 `role="checkbox"` + `aria-checked` 而不是 `aria-pressed`：
 * 前者的语义是「这一项被选中了吗」，后者是「这个按钮按下去了吗」。
 * `indeterminate` 走 `aria-checked="mixed"`，读屏会念「部分选中」。
 */
export default function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  indeterminate = false,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const box = (
    <span
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label === undefined ? ariaLabel : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={`${styles.box} ${checked || indeterminate ? styles.on : ''} ${
        indeterminate ? styles.mixed : ''
      }`}
      onClick={(e) => {
        if (disabled) return;
        // 有 label 时点击会先冒泡到 label 的 onClick，那里统一处理；这里只挡重复触发
        e.preventDefault();
        onChange(!checked);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      {/* 勾与横杠都用 CSS 伪元素画（见 index.module.css）——
          它们纯粹是装饰，不该在无障碍树里多出两个空节点 */}
    </span>
  );

  if (label === undefined) return box;

  return (
    <label className={`${styles.row} ${disabled ? styles.disabled : ''}`}>
      {box}
      <span className={styles.label}>{label}</span>
    </label>
  );
}
