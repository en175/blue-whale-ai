import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
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

const HOVER_CLOSE_DELAY_MS = 120;

export default function FrameInterpolationMenu({ items, triggerDisabledReason }: FrameInterpolationMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const primaryItem = items[0];
  const triggerDisabled = triggerDisabledReason != null;
  const triggerTitle = triggerDisabledReason ?? primaryItem?.disabledReason ?? undefined;

  const cancelScheduledClose = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const close = () => {
    cancelScheduledClose();
    setOpen(false);
  };

  const scheduleClose = () => {
    if (closeTimerRef.current != null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  };

  useEffect(() => cancelScheduledClose, []);

  useDismissOnOutside([
    { open, ref: wrapRef, dismiss: close },
  ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cancelScheduledClose();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const launch = (item: FrameInterpolationMenuItem) => {
    close();
    item.onSelect();
  };

  if (!primaryItem) return null;

  return (
    <div
      className={`nodrag nopan ${styles.qualityWrap}`}
      ref={wrapRef}
      onMouseEnter={() => {
        cancelScheduledClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={styles.toolBtn}
        onClick={() => {
          if (triggerDisabled || primaryItem.disabledReason != null) return;
          launch(primaryItem);
        }}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-disabled={triggerDisabled || undefined}
        data-testid="video-enhance-menu-trigger"
      >
        <span className={styles.hdBadge}>HD</span>
        <span>高清</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.qualityMenu} role="menu" data-testid="video-enhance-menu">
          {items.map((item) => {
            const disabled = item.disabledReason != null;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={styles.qualityMenuItem}
                aria-disabled={disabled || undefined}
                title={item.disabledReason ?? item.hint}
                data-testid={`video-enhance-menu-item-${item.id}`}
                onClick={() => {
                  if (disabled) return;
                  launch(item);
                }}
              >
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
