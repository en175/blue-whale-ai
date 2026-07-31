/**
 * ToolbarFlyout —— 工具栏按钮悬浮列表（公共组件，IK55VM）。
 * 规范（IK54R1 决议，音频/资产库/商品卡三按钮共用）：点击按钮展开悬浮列表，
 * 点选即回调并关闭；再次点击按钮（调用方 toggle open）/点外/Esc 关闭。
 * 定位（IK56MS 定稿）：与锚定按钮顶对齐向下展开，距工具栏外框 6px——
 * 锚点是按钮本体，left = 按钮右缘 + 容器 padding(8) + 6 = r.right + 14；createPortal 到 body。
 * 点外关闭用捕获阶段监听（IK56MS 反馈 5）：React Flow 画布 pane 在冒泡链上
 * stopPropagation，冒泡监听收不到画布空白处点击。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ToolbarFlyoutItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** IK55VS：置灰项（如「导入卡片」功能后续票）——不可点、不触发 onSelect/onClose。 */
  disabled?: boolean;
  /** 置灰项右侧小字标注（如「后续」）。 */
  hint?: string;
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
    document.addEventListener("mousedown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchor]);

  if (!open || !anchor || typeof document === "undefined") return null;

  // 按锚定按钮定位（渲染期直读，无需 effect+state）：
  // 顶对齐向下展开；距工具栏外框 6px = 容器 padding 8 + 6，即按钮右缘 +14。
  // （耦合 LeftToolbar 容器 padding:8——若调整需同步此处的 14。）
  const r = anchor.getBoundingClientRect();
  const pos = { left: r.right + 14, top: r.top };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
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
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            onSelect(item.id);
          }}
          style={{
            width: "100%",
            padding: "7px 10px",
            borderRadius: 6,
            border: 0,
            background: "transparent",
            color: item.disabled
              ? "var(--tc-text-muted)"
              : "var(--tc-menu-item-label)",
            cursor: item.disabled ? "not-allowed" : "pointer",
            fontSize: 12,
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 8,
            whiteSpace: "nowrap",
            transition: "background 80ms",
          }}
          onMouseEnter={(e) => {
            if (!item.disabled)
              e.currentTarget.style.background = "var(--tc-menu-item-hover)";
          }}
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          {item.icon && (
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                color: item.disabled
                  ? "var(--tc-text-muted)"
                  : "var(--tc-text-secondary)",
                flexShrink: 0,
              }}
            >
              {item.icon}
            </span>
          )}
          <span style={{ flex: 1 }}>{item.label}</span>
          {item.hint && (
            <span style={{ fontSize: 10, color: "var(--tc-text-muted)" }}>
              {item.hint}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
