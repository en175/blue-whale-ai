import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

export interface CheckboxProps {
  checked: boolean;
  className?: string;
}

export default function Checkbox({ checked, className }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      asChild
      checked={checked}
      aria-hidden
      tabIndex={-1}
    >
      <span
        className={joinClassNames(styles.mark, className)}
        data-selected={checked ? 'true' : 'false'}
      >
        <CheckboxPrimitive.Indicator forceMount>
          <Check size={14} strokeWidth={2} />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
