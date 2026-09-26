/* ============================================
 * Button —— 管理端唯一的按钮
 *
 * 只有三种变体：primary / default / danger，加一个 ghost（低强调动作）。
 * 克制变体数量是刻意的：变体一多，每个页面就会开始挑自己喜欢的那个。
 * ============================================ */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './index.module.css';

export type ButtonVariant = 'primary' | 'default' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 前置图标（lucide 组件）。与文字同色，尺寸由 size 决定。 */
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.primary,
  default: '',
  danger: styles.danger,
  ghost: styles.ghost,
};

export default function Button({
  variant = 'default',
  size = 'md',
  icon,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    // type 默认 button：HTML 里 button 默认是 submit，放进表单会意外提交。
    // 这在管理端尤其常见（筛选栏套在 form 里），统一显式声明省掉一类隐性 bug。
    <button
      type={type}
      className={[styles.btn, VARIANT_CLASS[variant], size === 'sm' ? styles.sm : '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
