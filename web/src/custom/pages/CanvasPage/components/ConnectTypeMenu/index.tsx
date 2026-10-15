import { type ConnectGenKind } from '@/custom/enums';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import styles from './index.module.css';

const ITEMS: Array<{ kind: ConnectGenKind; label: string }> = [
  { kind: 'image', label: '图片生成' },
  { kind: 'video', label: '视频生成' },
  { kind: 'audio', label: '音频生成' },
];

interface ConnectTypeMenuProps {
  x: number;
  y: number;
  enabled: Set<ConnectGenKind>;
  onSelect: (kind: ConnectGenKind) => void;
  onClose: () => void;
}

export default function ConnectTypeMenu({ x, y, enabled, onSelect, onClose }: ConnectTypeMenuProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const close = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(`.${styles.menu}`)) return;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('contextmenu', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('contextmenu', close, true);
    };
  }, []);

  return createPortal(
    <div
      className={styles.menu}
      style={{ top: y, left: x }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {ITEMS.map((item) => {
        const ok = enabled.has(item.kind);
        return (
          <button
            key={item.kind}
            type="button"
            className={styles.item}
            disabled={!ok}
            onClick={() => {
              if (!ok) return;
              onSelect(item.kind);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
