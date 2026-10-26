import { ChevronDown, WandSparkles } from 'lucide-react';
import DropdownMenu from '@/custom/components/DropdownMenu';
import styles from './index.module.css';

export interface SmartMattingMenuItem {
  id: string;
  label: string;
  hint: string;
  disabledReason: string | null;
  onSelect: () => void;
}

interface SmartMattingMenuProps {
  items: SmartMattingMenuItem[];
  triggerHint?: string;
}

export default function SmartMattingMenu({ items, triggerHint }: SmartMattingMenuProps) {
  const primaryItem = items[0];
  const gateReason = items.find((item) => item.disabledReason != null)?.disabledReason ?? null;
  const launchDisabled = gateReason != null;
  if (!primaryItem) return null;

  return (
    <DropdownMenu
      openOnHover
      canvasSafe
      wrapClassName={styles.qualityWrap}
      contentTestId="smart-matting-menu"
      trigger={
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => {
            if (launchDisabled) return;
            primaryItem.onSelect();
          }}
          title={gateReason ?? triggerHint}
          aria-haspopup="menu"
          aria-disabled={launchDisabled || undefined}
          data-testid="smart-matting-menu-trigger"
        >
          <WandSparkles size={14} strokeWidth={2} />
          <span>智能抠像</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      }
      items={items.map((item) => ({
        key: item.id,
        label: item.label,
        title: item.hint,
        disabled: item.disabledReason != null,
        testId: `smart-matting-menu-item-${item.id}`,
        onSelect: item.onSelect,
      }))}
    />
  );
}
