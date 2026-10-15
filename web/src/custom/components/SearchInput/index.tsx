import { Search } from 'lucide-react';
import type { KeyboardEvent, InputHTMLAttributes } from 'react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

export type SearchInputVariant = 'field' | 'inline' | 'plain';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variant?: SearchInputVariant;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  ariaLabel?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder,
  variant = 'inline',
  autoFocus,
  className,
  inputClassName,
  onKeyDown,
  ariaLabel,
}: SearchInputProps) {
  const inputProps: InputHTMLAttributes<HTMLInputElement> = {
    className: joinClassNames(styles.input, inputClassName),
    value,
    placeholder,
    autoFocus,
    onChange: (event) => onChange(event.target.value),
    onKeyDown,
    'aria-label': ariaLabel ?? placeholder,
  };

  return (
    <div
      className={joinClassNames(
        styles.root,
        variant === 'field' ? styles.field : variant === 'inline' ? styles.inline : styles.plain,
        className,
      )}
    >
      <Search size={variant === 'field' ? 15 : 14} strokeWidth={2} className={styles.icon} aria-hidden="true" />
      <input {...inputProps} />
    </div>
  );
}
