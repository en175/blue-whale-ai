"use client";

/**
 * MediaPreviewModal —— 全屏遮罩预览 Dock 素材（图片/视频/音频）
 * 点击遮罩或 Esc 关闭。不引入第三方库。
 */
import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { AudioLines, X } from "lucide-react";
import type { DockMediaItem } from "@/app/canvas/_canvas/types";

export function MediaPreviewModal({
  item,
  onClose,
}: {
  item: DockMediaItem;
  onClose: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-label={`预览 ${item.name}`}
      data-tc-dock-popover=""
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483646,
        background: "var(--tc-bg-overlay)",
        backdropFilter: "blur(12px)",
        boxShadow: "var(--tc-modal-shadow)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {/* 关闭按钮 */}
      <button
        type="button"
        aria-label="关闭预览"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 36,
          height: 36,
          borderRadius: 8,
          border: 0,
          background: "var(--tc-border-subtle)",
          color: "var(--tc-text-primary)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        <X width={20} height={20} strokeWidth={2} />
      </button>

      {/* 内容 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "90vw",
          maxHeight: "90vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "default",
        }}
      >
        {item.type === "image" && item.src ? (
          <img
            src={item.src}
            alt={item.name}
            style={{
              maxWidth: "90vw",
              maxHeight: "90vh",
              objectFit: "contain",
              borderRadius: 8,
            }}
          />
        ) : item.type === "video" && item.src ? (
          <video
            src={item.src}
            controls
            autoPlay
            muted
            style={{
              maxWidth: "90vw",
              maxHeight: "90vh",
              borderRadius: 8,
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              color: "var(--tc-text-muted)",
            }}
          >
            <AudioLines width={64} height={64} strokeWidth={1.5} />
            <span style={{ fontSize: 14 }}>{item.name}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
