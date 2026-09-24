/* ============================================
 * Select —— 下拉选择
 *
 * ⚠️ **刻意用原生 <select>，不自绘浮层**。
 *
 * 管理端原来各页自己画下拉菜单，结果是：菜单浮层用了深色主题的样式，浅色化时
 * 完全没被覆盖到（它写在组件里，不在页面 CSS 里），于是「白底页面上弹出一个黑菜单」。
 * 这类 bug 的根因是**自绘浮层 = 又多一套需要跟着主题走的样式**。
 *
 * 原生 select 的候选列表由操作系统渲染，跟随 `color-scheme`（已在 admin.css 里设 light），
 * 不需要也不可能被我们的 CSS 弄坏——少一整类问题。代价是样式定制能力有限，
 * 但管理端要的只是「能选、看得清」。
 * ============================================ */
import type { ReactNode, SelectHTMLAttributes } from 'react';
import styles from './index.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'> {
  options: readonly SelectOption[];
  /** 占位项（值为空字符串）。给了才渲染 */
  placeholder?: string;
  size?: 'sm' | 'md';
  children?: ReactNode;
}

export default function Select({
  options,
  placeholder,
  size = 'md',
  ...rest
}: SelectProps) {
  return (
    <select className={`${styles.select} ${size === 'sm' ? styles.sm : ''}`} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
