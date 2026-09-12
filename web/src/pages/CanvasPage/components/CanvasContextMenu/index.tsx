/* ============================================
 * 画布右键菜单：节点菜单与空白处菜单共用
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import styles from './index.module.css';

export interface CanvasContextMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  children?: Array<{ key: string; label: string }>;
}

interface CanvasContextMenuProps {
  x: number;
  y: number;
  items: CanvasContextMenuItem[];
  onSelect: (key: string) => void;
  onClose: () => void;
}

export default function CanvasContextMenu({ x, y, items, onSelect, onClose }: CanvasContextMenuProps) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  const closeSubTimer = useRef<number | null>(null);

  const openSubmenu = (key: string) => {
    if (closeSubTimer.current != null) {
      window.clearTimeout(closeSubTimer.current);
      closeSubTimer.current = null;
    }
    setOpenSub(key);
  };

  const scheduleCloseSubmenu = () => {
    if (closeSubTimer.current != null) window.clearTimeout(closeSubTimer.current);
    closeSubTimer.current = window.setTimeout(() => {
      setOpenSub(null);
      closeSubTimer.current = null;
    }, 200);
  };

  useEffect(() => {
    const close = () => onClose();
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close, true);
      if (closeSubTimer.current != null) window.clearTimeout(closeSubTimer.current);
    };
  }, [onClose]);

  return createPortal(
    <div
      className={styles.menu}
      style={{ top: y, left: x }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) =>
        item.children ? (
          <div
            key={item.key}
            className={styles.subWrap}
            onMouseEnter={() => openSubmenu(item.key)}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <button type="button" className={styles.item} disabled={item.disabled}>
              <span>{item.label}</span>
              <ChevronRight size={14} strokeWidth={2} />
            </button>
            {openSub === item.key && (
              <div className={styles.subMenu}>
                {item.children.map((child) => (
                  <button
                    key={child.key}
                    type="button"
                    className={styles.item}
                    onClick={() => onSelect(child.key)}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            key={item.key}
            type="button"
            className={`${styles.item} ${item.danger ? styles.danger : ''}`}
            disabled={item.disabled || item.loading}
            onClick={() => {
              if (item.disabled || item.loading) return;
              onSelect(item.key);
            }}
          >
            {item.loading ? `${item.label}中…` : item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
