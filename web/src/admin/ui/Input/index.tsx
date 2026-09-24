/* ============================================
 * Input —— 输入框
 *
 * 与 Select 同高同圆角，否则一排筛选器高低不齐——那是「没做过设计」最直观的观感。
 * ============================================ */
import type { InputHTMLAttributes } from 'react';
import styles from './index.module.css';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  size?: 'sm' | 'md';
}

export default function Input({ size = 'md', type = 'text', ...rest }: InputProps) {
  return <input type={type} className={`${styles.input} ${size === 'sm' ? styles.sm : ''}`} {...rest} />;
}
