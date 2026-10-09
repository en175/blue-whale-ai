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
    <div className={styles.tabs} role="tablist">
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`${styles.tab} ${active ? styles.active : ''}`}
            onClick={() => onChange(item.key)}
          >
            {item.label}
            {item.count !== undefined && <span className={styles.count}>{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
