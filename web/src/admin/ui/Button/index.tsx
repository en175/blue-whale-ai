import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './index.module.css';

export type ButtonVariant = 'primary' | 'default' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
