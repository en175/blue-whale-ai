"use client";
import { useEffect } from "react";
export type { NodeMenuAction } from "../types";
import type { NodeMenuAction } from "../types";

export type NodeContextMenuProps = {
  screenX: number;
  screenY: number;
  hideSaveToAssets?: boolean;
  onAction: (action: NodeMenuAction) => void;
  onClose: () => void;
};

const ITEMS: {
  action: NodeMenuAction;
  label: string;
  shortcut?: string;
  destructive?: boolean;
}[] = [
  { action: "add-to-chat", label: "添加到聊天" },
  { action: "save-to-assets", label: "保存到共享资产" },
  { action: "copy", label: "拷贝", shortcut: "⌘C" },
  { action: "duplicate", label: "复制", shortcut: "⌘D" },
  { action: "delete", label: "删除", destructive: true },
];

export function NodeContextMenu({
  screenX,
  screenY,
  hideSaveToAssets,
  onAction,
  onClose,
}: NodeContextMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = setTimeout(() => window.addEventListener("click", close), 0);
    window.addEventListener("keydown", onEsc);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const items = hideSaveToAssets
    ? ITEMS.filter((i) => i.action !== "save-to-assets")
    : ITEMS;

  return (
    <div
      data-testid="node-context-menu"
      role="menu"
      style={{
        position: "fixed",
        left: Math.min(
          screenX,
          (typeof window !== "undefined" ? window.innerWidth : 9999) - 200,
        ),
        top: Math.min(
          screenY,
          (typeof window !== "undefined" ? window.innerHeight : 9999) - 220,
        ),
        zIndex: 2147483647,
        background: "var(--tc-bg-surface)",
        border: "1px solid var(--tc-border-subtle)",
        borderRadius: 10,
        boxShadow: "var(--tc-dropdown-shadow)",
        backdropFilter: "blur(12px)",
        padding: 4,
        minWidth: 180,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          data-action={item.action}
          onClick={() => onAction(item.action)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--tc-menu-item-hover)]"
          style={{
            color: item.destructive
              ? "var(--tc-destructive)"
              : "var(--tc-menu-item-label)",
            border: 0,
            background: "transparent",
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && (
            <span
              className="ml-4 text-xs"
              style={{ color: "var(--tc-text-secondary)" }}
            >
              {item.shortcut}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
