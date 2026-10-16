import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

export type SelectSize = 'sm' | 'md';
export type SelectSide = 'top' | 'bottom';

export interface SelectOption<V extends string = string> {
  value: V;
  label: ReactNode;
  text?: string;
  disabled?: boolean;
  title?: string;
  testId?: string;
}

export interface SelectProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  size?: SelectSize;
  side?: SelectSide;
  disabled?: boolean;
  placeholder?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  label?: ReactNode;
  triggerRender?: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  contentClassName?: string;
  ariaLabel?: string;
  testId?: string;
  onTriggerClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export default function Select<V extends string = string>({
  value,
  onChange,
  options,
  size = 'md',
  side = 'bottom',
  disabled = false,
  placeholder,
  leading,
  trailing,
  label,
  triggerRender,
  triggerClassName,
  triggerTitle,
  contentClassName,
  ariaLabel,
  testId,
  onTriggerClick,
}: SelectProps<V>) {
  const active = options.find((option) => option.value === value);
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const stop = (event: MouseEvent) => event.stopPropagation();
    node.addEventListener('mousedown', stop);
  }, []);

  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
      {label != null && <SelectPrimitive.Label className={styles.label}>{label}</SelectPrimitive.Label>}
      <SelectPrimitive.Trigger
        className={joinClassNames('nodrag', 'nopan', styles.trigger, styles[size], triggerClassName)}
        title={triggerTitle}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={onTriggerClick}
      >
        {triggerRender ?? (
          <>
            {leading}
            <span className={styles.value}>
              {active ? (active.text ?? active.label) : placeholder}
            </span>
            {trailing ?? (
              <ChevronDown
                size={size === 'sm' ? 12 : 14}
                strokeWidth={2}
                className={styles.arrow}
              />
            )}
          </>
        )}
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={contentRef}
          className={joinClassNames(styles.content, contentClassName)}
          position="popper"
          side={side}
          sideOffset={6}
          align="start"
          updatePositionStrategy="always"
          data-gen-panel-territory
        >
          <SelectPrimitive.Viewport className={styles.viewport}>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                textValue={option.text}
                title={option.title}
                data-testid={option.testId}
                className={joinClassNames(styles.option, option.value === value ? styles.optionActive : '')}
              >
                <span
                  className={styles.check}
                  data-selected={option.value === value ? 'true' : 'false'}
                  aria-hidden
                >
                  <Check size={14} strokeWidth={2} />
                </span>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
