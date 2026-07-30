/**
 * ToolbarFlyout —— 工具栏按钮悬浮列表（公共组件，IK55VM）。
 * 规范（IK54R1 决议，音频/资产库/商品卡三按钮共用）：点击按钮展开悬浮列表，
 * 点选即回调并关闭；再次点击按钮（调用方 toggle open）/点外/Esc 关闭。
 * 定位：锚定按钮右侧、垂直居中，createPortal 到 body。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ToolbarFlyoutItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
};

export function ToolbarFlyout({
  open,
  anchor,
  items,
  onSelect,
  onClose,
  ariaLabel = "功能列表",
}: {
  open: boolean;
  /** 锚定元素（工具栏按钮）；null 时不渲染。 */
  anchor: HTMLElement | null;
  items: ToolbarFlyoutItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  ariaLabel?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchor]);

  if (!open || !anchor || typeof document === "undefined") return null;

  // 按锚定按钮定位：右侧 8px、垂直居中（渲染期直读，无需 effect+state）
  const r = anchor.getBoundingClientRect();
  const pos = { left: r.right + 8, top: r.top + r.height / 2 };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        transform: "translateY(-50%)",
        padding: 4,
        borderRadius: 10,
        background: "var(--tc-bg-surface)",
        border: "1px solid var(--tc-border-subtle)",
        boxShadow: "var(--tc-dropdown-shadow)",
        zIndex: 2147483602,
        minWidth: 132,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onSelect(item.id);
          }}
          style={{
            width: "100%",
            padding: "7px 10px",
            borderRadius: 6,
            border: 0,
            background: "transparent",
            color: "var(--tc-menu-item-label)",
            cursor: "pointer",
            fontSize: 12,
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 8,
            whiteSpace: "nowrap",
            transition: "background 80ms",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--tc-menu-item-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          {item.icon && (
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                color: "var(--tc-text-secondary)",
                flexShrink: 0,
              }}
            >
              {item.icon}
            </span>
          )}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
