/**
 * ContextMenu —— 画布右键 / edge drop 共享菜单（插 text/image/video 节点）。
 * 浮层用屏幕坐标（fixed）；onInsert 后 page 用世界坐标建节点（+ drop 时连边）。
 */
"use client";
import { useEffect } from "react";

export type ContextMenuKind = "text" | "image" | "video";

export type ContextMenuProps = {
  screenX: number;
  screenY: number;
  /** drop（有 source，连边）vs 右键空白（纯插节点） */
  hasSource: boolean;
  onInsert: (kind: ContextMenuKind) => void;
  onClose: () => void;
};

const OPTIONS: { kind: ContextMenuKind; label: string }[] = [
  { kind: "text", label: "文本" },
  { kind: "image", label: "图片" },
  { kind: "video", label: "视频" },
];

export function ContextMenu({
  screenX,
  screenY,
  hasSource,
  onInsert,
  onClose,
}: ContextMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // 延迟绑 click 避免触发本次（菜单打开的）事件
    const t = setTimeout(() => window.addEventListener("click", close), 0);
    window.addEventListener("keydown", onEsc);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        left: Math.min(
          screenX,
          (typeof window !== "undefined" ? window.innerWidth : 9999) - 160,
        ),
        top: Math.min(
          screenY,
          (typeof window !== "undefined" ? window.innerHeight : 9999) - 160,
        ),
        zIndex: 2147483647,
        background: "var(--tc-bg-surface)",
        border: "1px solid var(--tc-border-subtle)",
        borderRadius: 12,
        boxShadow: "var(--tc-menu-pill-shadow)",
        backdropFilter: "blur(12px)",
        padding: 4,
        minWidth: 120,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="px-3 py-1 text-xs"
        style={{ color: "var(--tc-text-tertiary)" }}
      >
        {hasSource ? "连接并创建" : "插入"}
      </div>
      {OPTIONS.map((o) => (
        <button
          key={o.kind}
          type="button"
          onClick={() => onInsert(o.kind)}
          className="tc-ui-glow-btn block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--tc-menu-item-hover)] hover:text-white"
          style={{
            color: "var(--tc-text-secondary)",
            border: 0,
            background: "transparent",
          }}
        >
          {o.label}节点
        </button>
      ))}
    </div>
  );
}
