/* 拖线落到空白/内容节点后的生成类型菜单 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectGenKind } from '../../connectAbility';
import styles from './index.module.css';

const ITEMS: Array<{ kind: ConnectGenKind; label: string }> = [
  { kind: 'image', label: '图片生成' },
  { kind: 'video', label: '视频生成' },
  { kind: 'audio', label: '音频生成' },
  { kind: 'text', label: '文本生成' },
];

interface ConnectTypeMenuProps {
  x: number;
  y: number;
  enabled: Set<ConnectGenKind>;
  onSelect: (kind: ConnectGenKind) => void;
  onClose: () => void;
}

export default function ConnectTypeMenu({ x, y, enabled, onSelect, onClose }: ConnectTypeMenuProps) {
  useEffect(() => {
    const close = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(`.${styles.menu}`)) return;
      onClose();
    };
    // 等松开连线的那次 click 过完再监听，避免菜单刚弹出就被关掉
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', close);
      document.addEventListener('contextmenu', close, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('contextmenu', close, true);
    };
  }, [onClose]);

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
