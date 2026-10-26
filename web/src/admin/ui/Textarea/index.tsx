import type { TextareaHTMLAttributes } from 'react';
import styles from './index.module.css';

interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  rows?: number;
}

export default function Textarea({ rows = 6, ...rest }: TextareaProps) {
  return <textarea rows={rows} className={styles.textarea} {...rest} />;
}
