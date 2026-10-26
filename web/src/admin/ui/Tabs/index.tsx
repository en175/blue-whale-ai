import * as TabsPrimitive from '@radix-ui/react-tabs';
import styles from './index.module.css';

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (key: string) => void;
}

export default function Tabs({ items, value, onChange }: TabsProps) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange} activationMode="automatic">
      <TabsPrimitive.List className={styles.tabs}>
        {items.map((item) => {
          const active = item.key === value;
          return (
            <TabsPrimitive.Trigger
              key={item.key}
              value={item.key}
              className={`${styles.tab} ${active ? styles.active : ''}`}
            >
              {item.label}
              {item.count !== undefined && <span className={styles.count}>{item.count}</span>}
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
