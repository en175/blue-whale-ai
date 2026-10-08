import type { InputHTMLAttributes } from 'react';
import styles from './index.module.css';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'size'> {
  size?: 'sm' | 'md';
}

export default function Input({ size = 'md', type = 'text', ...rest }: InputProps) {
  return <input type={type} className={`${styles.input} ${size === 'sm' ? styles.sm : ''}`} {...rest} />;
}
