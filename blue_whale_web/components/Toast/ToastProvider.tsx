"use client";

/**
 * ToastProvider —— 订阅 toast store 并通过 portal 渲染通知列表。
 * 挂载在 layout 最外层，确保全局可用。
 */
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast, type ToastItem } from "./toast";
import { X } from "lucide-react";

/** 单条 Toast 通知（绝对定位在右上角栈中） */
function ToastBar({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const bg =
    item.type === "error"
      ? "var(--tc-toast-error-bg)"
      : "var(--tc-toast-success-bg)";

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        maxWidth: 360,
        padding: "10px 14px",
        borderRadius: "var(--tc-toast-rounded, 8px)",
        background: bg,
        backdropFilter: "blur(20px)",
        color: "var(--tc-toast-text, #ffffff)",
        fontSize: "var(--tc-toast-font-size, 13px)",
        fontFamily: "var(--tc-toast-font, Outfit, -apple-system, sans-serif)",
        fontWeight: 500,
        lineHeight: "18px",
        boxShadow: "var(--tc-toast-shadow, 0 8px 24px rgba(0,0,0,0.4))",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(12px)",
        transition: "opacity 200ms ease-out, transform 200ms ease-out",
        pointerEvents: "auto",
        wordBreak: "break-word",
      }}
    >
      <span style={{ flex: "1 1 0%", minWidth: 0 }}>{item.message}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action!.onClick();
            onDismiss(item.id);
          }}
          style={{
            flexShrink: 0,
            padding: "2px 10px",
            border: 0,
            borderRadius: 6,
            background: "var(--tc-accent)",
            color: "var(--tc-on-accent, #ffffff)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            lineHeight: "18px",
          }}
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="关闭通知"
        onClick={() => onDismiss(item.id)}
        style={{
          flexShrink: 0,
          width: 18,
          height: 18,
          padding: 0,
          border: 0,
          borderRadius: 4,
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.7,
        }}
      >
        <X width={14} height={14} strokeWidth={2} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return toast.subscribe(setToasts);
  }, []);

  const handleDismiss = useCallback((id: string) => {
    toast.dismiss(id);
  }, []);

  if (!mounted) return <>{children}</>;

  return (
    <>
      {children}
      {createPortal(
        <div
          aria-label="通知列表"
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 2147483647,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            pointerEvents: "none",
          }}
        >
          {toasts.map((item) => (
            <ToastBar key={item.id} item={item} onDismiss={handleDismiss} />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
