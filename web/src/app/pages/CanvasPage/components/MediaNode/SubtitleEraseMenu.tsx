import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Subtitles } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
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

const HOVER_CLOSE_DELAY_MS = 120;

export default function SubtitleEraseMenu({ items }: SubtitleEraseMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const primaryItem = items[0];
  const gateReason = items.find((item) => item.disabledReason != null)?.disabledReason ?? null;
  const launchDisabled = gateReason != null;

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

  const launch = (item: SubtitleEraseMenuItem) => {
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
          if (launchDisabled) return;
          launch(primaryItem);
        }}
        title={gateReason ?? undefined}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-disabled={launchDisabled || undefined}
        data-testid="subtitle-erase-menu-trigger"
      >
        <Subtitles size={14} strokeWidth={2} />
        <span>智能去字幕</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.qualityMenu} role="menu" data-testid="subtitle-erase-menu">
          {items.map((item) => {
            const disabled = item.disabledReason != null;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={styles.qualityMenuItem}
                aria-disabled={disabled || undefined}
                title={item.hint}
                data-testid={`subtitle-erase-menu-item-${item.id}`}
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
