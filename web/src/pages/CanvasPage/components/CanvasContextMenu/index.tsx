/* ============================================
 * 画布右键菜单：节点菜单与空白处菜单共用
 * ============================================ */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** 菜单与视口边缘的最小间距 */
const VIEWPORT_MARGIN = 8;

/** 按视口夹取菜单位置：右侧超出向左翻，底部超出向上翻，其余贴边 */
function clampMenuPosition(x: number, y: number, width: number, height: number) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const maxLeft = vw - VIEWPORT_MARGIN - width;
  const maxTop = vh - VIEWPORT_MARGIN - height;

  let left = x;
  let top = y;

  if (left + width > vw - VIEWPORT_MARGIN) {
    left = x - width;
  }
  if (top + height > vh - VIEWPORT_MARGIN) {
    top = y - height;
  }

  left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, maxLeft));
  top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, maxTop));

  return { left, top };
}

export default function CanvasContextMenu({ x, y, items, onSelect, onClose }: CanvasContextMenuProps) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [subFlip, setSubFlip] = useState({ x: false, y: false });
  const menuRef = useRef<HTMLDivElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);
  const closeSubTimer = useRef<number | null>(null);

  const openSubmenu = (key: string) => {
    if (closeSubTimer.current != null) {
      window.clearTimeout(closeSubTimer.current);
      closeSubTimer.current = null;
    }
    if (key !== openSub) setSubFlip({ x: false, y: false });
    setOpenSub(key);
  };

  const scheduleCloseSubmenu = () => {
    if (closeSubTimer.current != null) window.clearTimeout(closeSubTimer.current);
    closeSubTimer.current = window.setTimeout(() => {
      setOpenSub(null);
      closeSubTimer.current = null;
    }, 200);
  };

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setPos(clampMenuPosition(x, y, width, height));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [x, y, items]);

  useLayoutEffect(() => {
    if (!openSub) {
      setSubFlip({ x: false, y: false });
      return;
    }
    const el = subMenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    setSubFlip({
      x: rect.right > vw - VIEWPORT_MARGIN,
      y: rect.bottom > vh - VIEWPORT_MARGIN,
    });
  }, [openSub]);

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
      ref={menuRef}
      className={styles.menu}
      style={{ top: pos.top, left: pos.left }}
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
              <div
                ref={subMenuRef}
                className={`${styles.subMenu}${subFlip.x ? ` ${styles.subMenuFlipX}` : ''}${subFlip.y ? ` ${styles.subMenuFlipY}` : ''}`}
              >
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
