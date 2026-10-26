import { AudioLines, ChevronDown } from 'lucide-react';
import DropdownMenu from '@/custom/components/DropdownMenu';
import styles from './index.module.css';

export interface AudioVideoSplitMenuItem {
  id: string;
  label: string;
  hint: string;
  disabledReason: string | null;
  onSelect: () => void;
}

interface AudioVideoSplitMenuProps {
  items: AudioVideoSplitMenuItem[];
  triggerHint?: string;
}

export default function AudioVideoSplitMenu({ items, triggerHint }: AudioVideoSplitMenuProps) {
  const primaryItem = items[0];
  const gateReason = items.find((item) => item.disabledReason != null)?.disabledReason ?? null;
  const launchDisabled = gateReason != null;
  if (!primaryItem) return null;

  return (
    <DropdownMenu
      openOnHover
      canvasSafe
      wrapClassName={styles.qualityWrap}
      contentTestId="audio-video-split-menu"
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
          data-testid="audio-video-split-menu-trigger"
        >
          <AudioLines size={14} strokeWidth={2} />
          <span>音视频分离</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      }
      items={items.map((item) => ({
        key: item.id,
        label: item.label,
        title: item.hint,
        disabled: item.disabledReason != null,
        testId: `audio-video-split-menu-item-${item.id}`,
        onSelect: item.onSelect,
      }))}
    />
  );
}
