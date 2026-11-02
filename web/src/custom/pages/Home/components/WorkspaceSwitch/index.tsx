import { Sparkles, LayoutGrid } from 'lucide-react';
import type { HomeWorkspace } from '../../index';
import styles from './index.module.css';

const ITEMS: { key: HomeWorkspace; label: string; icon: typeof Sparkles }[] = [
  { key: 'create', label: '生成', icon: Sparkles },
  { key: 'canvas', label: '画布', icon: LayoutGrid },
];

export default function WorkspaceSwitch({
  value,
  onChange,
}: {
  value: HomeWorkspace;
  onChange: (value: HomeWorkspace) => void;
}) {
  return (
    <div className={styles.switch} data-selected={value} role="group" aria-label="工作方式">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            className={styles.item}
            aria-pressed={value === item.key}
            onClick={() => onChange(item.key)}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
