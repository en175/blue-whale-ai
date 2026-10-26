import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { ReactNode } from 'react';
import RatioIcon from '@/custom/components/RatioIcon';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

export type RatioGroupVariant = 'track' | 'tiles' | 'compact';

export interface RatioGroupOption<V extends string = string> {
  value: V;
  label: ReactNode;
  showIcon?: boolean;
  title?: string;
  testId?: string;
  disabled?: boolean;
}

export interface RatioGroupProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  options: RatioGroupOption<V>[];
  variant?: RatioGroupVariant;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  testId?: string;
}

export default function RatioGroup<V extends string = string>({
  value,
  onChange,
  options,
  variant = 'track',
  disabled,
  ariaLabel,
  className,
  testId = 'ratio-group',
}: RatioGroupProps<V>) {
  const itemClass =
    variant === 'compact' ? styles.compactItem : variant === 'tiles' ? styles.tilesItem : styles.stackedItem;

  return (
    <ToggleGroup.Root
      type="single"
      rovingFocus={false}
      value={value}
      onValueChange={(next) => {
        onChange((next || value) as V);
      }}
      disabled={disabled}
      className={joinClassNames(
        styles.root,
        variant === 'track' ? styles.track : variant === 'tiles' ? styles.tiles : styles.compact,
        className,
      )}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          title={option.title}
          data-testid={option.testId}
          aria-pressed={option.value === value}
          className={joinClassNames(styles.item, itemClass)}
        >
          {option.showIcon === false ? null : <RatioIcon ratio={option.value} />}
          <span>{option.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
