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
  const toggle = () => {
    if (disabled) return;
    onChange(!checked);
  };

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
        // 有 label 时统一由外层 label 处理（点方框的 click 会冒泡上去），
        // 这里只挡掉浏览器对 label 的默认激活行为，否则会切换两次
        e.preventDefault();
        if (label === undefined) toggle();
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {/* 勾与横杠都用 CSS 伪元素画（见 index.module.css）——
          它们纯粹是装饰，不该在无障碍树里多出两个空节点 */}
    </span>
  );

  if (label === undefined) return box;

  return (
    // ⚠️ 点击处理挂在 label 上而不是只挂在方框上：`<span role="checkbox">` 不是
    //    labelable 元素，浏览器不会把「点文字」转发给它 —— 只挂方框的话，
    //    点「周一」这两个字不会有任何反应（而用户几乎总是点文字）。
    <label
      className={`${styles.row} ${disabled ? styles.disabled : ''}`}
      onClick={(e) => {
        e.preventDefault();
        toggle();
      }}
    >
      {box}
      <span className={styles.label}>{label}</span>
    </label>
  );
}
