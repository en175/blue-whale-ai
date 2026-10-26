import { ChevronDown, Subtitles } from 'lucide-react';
import DropdownMenu from '@/custom/components/DropdownMenu';
import styles from './index.module.css';

export interface SubtitleEraseMenuItem {
  id: string;
  label: string;
  hint: string;
  disabledReason: string | null;
  onSelect: () => void;
}

interface SubtitleEraseMenuProps {
  items: SubtitleEraseMenuItem[];
}

export default function SubtitleEraseMenu({ items }: SubtitleEraseMenuProps) {
  const primaryItem = items[0];
  const gateReason = items.find((item) => item.disabledReason != null)?.disabledReason ?? null;
  const launchDisabled = gateReason != null;
  if (!primaryItem) return null;

  return (
    <DropdownMenu
      openOnHover
      canvasSafe
      wrapClassName={styles.qualityWrap}
      contentTestId="subtitle-erase-menu"
      trigger={
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => {
            if (launchDisabled) return;
            primaryItem.onSelect();
          }}
          title={gateReason ?? undefined}
          aria-haspopup="menu"
          aria-disabled={launchDisabled || undefined}
          data-testid="subtitle-erase-menu-trigger"
        >
          <Subtitles size={14} strokeWidth={2} />
          <span>智能去字幕</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      }
      items={items.map((item) => ({
        key: item.id,
        label: item.label,
        title: item.hint,
        disabled: item.disabledReason != null,
        testId: `subtitle-erase-menu-item-${item.id}`,
        onSelect: item.onSelect,
      }))}
    />
  );
}
