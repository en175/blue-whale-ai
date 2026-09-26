/* ============================================
 * Tabs —— 页签
 *
 * 受控组件：选中态由调用方持有（很多页面要按页签重新拉数据，内部管理反而不便）。
 * ============================================ */
import styles from './index.module.css';

export interface TabItem {
  key: string;
  label: string;
  /** 可选计数角标，如「图片 12」 */
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
