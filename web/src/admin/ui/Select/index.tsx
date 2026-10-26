import * as SelectPrimitive from '@radix-ui/react-select';
import styles from './index.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

const EMPTY_VALUE_PLACEHOLDER = '__admin_radix_empty__';

function emptyPlaceholderValue(options: readonly SelectOption[]): string {
  let candidate = EMPTY_VALUE_PLACEHOLDER;
  while (options.some((option) => option.value === candidate)) candidate += '_';
  return candidate;
}

function toRadixValue(optionValue: string, emptyValue: string): string {
  return optionValue === '' ? emptyValue : optionValue;
}

function fromRadixValue(radixValue: string, emptyValue: string): string {
  return radixValue === emptyValue ? '' : radixValue;
}

export default function Select({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  size = 'md',
  'aria-label': ariaLabel,
}: SelectProps) {
  const emptyValue = emptyPlaceholderValue(options);
  const selected = options.find((option) => option.value === value);

  return (
    <SelectPrimitive.Root
      value={selected === undefined ? undefined : toRadixValue(value, emptyValue)}
      onValueChange={(next) => onChange(fromRadixValue(next, emptyValue))}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={`${styles.trigger} ${size === 'sm' ? styles.sm : ''}`}
        aria-label={ariaLabel}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <svg className={styles.chevron} width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className={styles.menu} position="popper" sideOffset={4} align="start">
          <SelectPrimitive.Viewport className={styles.viewport}>
            {options.map((option) => {
              const active = option.value === value;
              return (
                <SelectPrimitive.Item
                  key={option.value}
                  value={toRadixValue(option.value, emptyValue)}
                  disabled={option.disabled}
                  className={`${styles.option} ${active ? styles.optionActive : ''} ${
                    option.disabled ? styles.optionDisabled : ''
                  }`}
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
