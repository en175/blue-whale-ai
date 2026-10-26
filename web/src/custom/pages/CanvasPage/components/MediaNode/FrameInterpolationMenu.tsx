import { ChevronDown } from 'lucide-react';
import DropdownMenu from '@/custom/components/DropdownMenu';
import styles from './index.module.css';

export interface FrameInterpolationMenuItem {
  id: string;
  label: string;
  hint: string;
  disabledReason: string | null;
  onSelect: () => void;
}

interface FrameInterpolationMenuProps {
  items: FrameInterpolationMenuItem[];
  triggerDisabledReason: string | null;
}

export default function FrameInterpolationMenu({ items, triggerDisabledReason }: FrameInterpolationMenuProps) {
  const primaryItem = items[0];
  const triggerDisabled = triggerDisabledReason != null;
  const triggerTitle = triggerDisabledReason ?? primaryItem?.disabledReason ?? undefined;
  if (!primaryItem) return null;

  return (
    <DropdownMenu
      openOnHover
      canvasSafe
      wrapClassName={styles.qualityWrap}
      contentTestId="video-enhance-menu"
      trigger={
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => {
            if (triggerDisabled || primaryItem.disabledReason != null) return;
            primaryItem.onSelect();
          }}
          title={triggerTitle}
          aria-haspopup="menu"
          aria-disabled={triggerDisabled || undefined}
          data-testid="video-enhance-menu-trigger"
        >
          <span className={styles.hdBadge}>HD</span>
          <span>高清</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      }
      items={items.map((item) => ({
        key: item.id,
        label: item.label,
        title: item.disabledReason ?? item.hint,
        disabled: item.disabledReason != null,
        testId: `video-enhance-menu-item-${item.id}`,
        onSelect: item.onSelect,
      }))}
    />
  );
}
