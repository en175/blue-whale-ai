/**
 * UploadSourceMenu —— Dock 上传来源浮层（展示 + 局部状态层）
 * 两项菜单：「本地上传」「从画布选择」。点占位/加号触发，经 createPortal 向上展开。
 * 通过 onLocalUpload 触发各自 Dock 的隐藏 file input；onPickFromCanvas 上抛进入画布选择模式。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Move, Upload } from "lucide-react";

export function UploadSourceMenu({
  triggerRef,
  open,
  onClose,
  onLocalUpload,
  onPickFromCanvas,
}: {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  onLocalUpload: () => void;
  onPickFromCanvas: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [visible, setVisible] = useState(false);

  // 按触发按钮定位，向上展开（Dock 贴底）
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ left: r.left, bottom: window.innerHeight - r.top + 8 });
    setVisible(true);
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
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
  }, [open, onClose, triggerRef]);

  if (!open || typeof document === "undefined") return null;

  const itemStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 10px",
    borderRadius: 5,
    background: "transparent",
    color: "rgba(255, 255, 255, 0.7)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 400,
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
    transition: "background 80ms",
    border: 0,
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="上传来源"
      data-tc-dock-popover=""
      style={{
        position: "fixed",
        left: pos.left,
        bottom: pos.bottom,
        padding: 4,
        borderRadius: 10,
        background: "rgb(26, 26, 26)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
        zIndex: 2147483602,
        minWidth: 200,
        width: "max-content",
        whiteSpace: "nowrap",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1) translateY(0)" : "scale(0.96) translateY(4px)",
        transformOrigin: "left bottom",
        transition:
          "opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <button
        type="button"
        role="menuitem"
        style={itemStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        onClick={() => {
          onClose();
          onLocalUpload();
        }}
      >
        <Upload width={13} height={13} strokeWidth={2} aria-hidden="true" style={{ opacity: 0.5, flexShrink: 0 }} />
        <span>本地上传</span>
      </button>
      <button
        type="button"
        role="menuitem"
        style={itemStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        onClick={() => {
          onClose();
          onPickFromCanvas();
        }}
      >
        <Move width={13} height={13} strokeWidth={2} aria-hidden="true" style={{ opacity: 0.5, flexShrink: 0 }} />
        <span>从画布选择</span>
      </button>
    </div>,
    document.body,
  );
}
