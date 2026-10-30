import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Image as ImageIcon, Sparkles, Video } from 'lucide-react';
import styles from './ModeMenu.module.css';

export type ChatModeKey = 'agent' | 'image' | 'video';

const ICONS = { agent: Sparkles, image: ImageIcon, video: Video } as const;

export default function ModeMenu({
  value,
  items,
  onChange,
}: {
  value: ChatModeKey;
  items: { key: ChatModeKey; label: string }[];
  onChange: (value: ChatModeKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = items.find((item) => item.key === value) ?? items[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.modeRoot} ref={rootRef}>
      <button
        type="button"
        className={styles.modeTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{active?.label}</span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.modePopover} role="menu" aria-label="生成模式">
          {items.map((item) => {
            const Icon = ICONS[item.key];
            return (
              <button
                key={item.key}
                type="button"
                role="menuitemradio"
                aria-checked={item.key === value}
                onClick={() => {
                  onChange(item.key);
                  setOpen(false);
                }}
              >
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>{item.label}</span>
                {item.key === value && <Check size={16} strokeWidth={2} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
