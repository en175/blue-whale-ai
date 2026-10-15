import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

export interface TabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  disabled?: boolean;
  testId?: string;
}

export interface TabsProps<K extends string = string> {
  items: TabItem<K>[];
  value: K | '';
  onChange: (key: K) => void;
  className?: string;
  triggerClassName?: string;
  activeTriggerClassName?: string;
  ariaLabel?: string;
}

export default function Tabs<K extends string = string>({
  items,
  value,
  onChange,
  className,
  triggerClassName,
  activeTriggerClassName,
  ariaLabel,
}: TabsProps<K>) {
  return (
    <TabsPrimitive.Root
      className={joinClassNames(styles.root, className)}
      value={value}
      onValueChange={(next) => onChange(next as K)}
      activationMode="automatic"
    >
      <TabsPrimitive.List className={styles.list} aria-label={ariaLabel}>
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.key}
            value={item.key}
            disabled={item.disabled}
            data-testid={item.testId}
            className={joinClassNames(
              styles.trigger,
              triggerClassName,
              value === item.key ? activeTriggerClassName : '',
            )}
            onClick={() => {
              if (!item.disabled) onChange(item.key);
            }}
          >
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
