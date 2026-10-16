import { Check } from 'lucide-react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

export interface CheckboxProps {
  checked: boolean;
  className?: string;
}

export default function Checkbox({ checked, className }: CheckboxProps) {
  return (
    <span
      className={joinClassNames(styles.mark, className)}
      data-selected={checked ? 'true' : 'false'}
      aria-hidden
    >
      <Check size={14} strokeWidth={2} />
    </span>
  );
}
