/**
 * Dock Parts —— Dock 共享部件（展示层）
 * DockMediaThumb：素材缩略图（点击预览 + 删除）。供 ImageDockContent / VideoDockContent / AudioDockContent 复用。
 */
import { useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, X, Maximize2, Minimize2 } from "lucide-react";
import { IconPlus } from "../../icons";
import type { DockMediaItem } from "../../types";
import { AuthenticatedImage } from "../AuthenticatedImage";

export function FrameUploadButton({
  label,
  previewUrl,
  onFile,
  onPick,
  onClear,
}: {
  label: string;
  previewUrl?: string;
  onFile?: (file: File) => void;
  onPick?: () => void;
  onClear?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        aria-hidden="true"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile?.(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label={label}
        onClick={() => inputRef.current?.click()}
        style={{
          width: 48,
          height: 48,
          aspectRatio: "1 / 1",
          padding: 0,
          boxSizing: "border-box",
          borderRadius: 12,
          flexShrink: 0,
          border: "1.5px dashed rgba(255, 255, 255, 0.08)",
          background: "rgba(255, 255, 255, 0.04)",
          color: "rgba(255, 255, 255, 0.3)",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          fontSize: 9,
          fontWeight: 500,
          transition: "120ms",
        }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={label}
            style={{
              width: 46,
              height: 46,
              objectFit: "cover",
              borderRadius: 10,
            }}
          />
        ) : (
          <>
            <span style={{ opacity: 0.4, flexShrink: 0 }}>
              <IconPlus size={14} />
            </span>
            <span style={{ color: "rgba(255, 255, 255, 0.25)" }}>{label}</span>
          </>
        )}
      </button>
      {previewUrl && onClear ? (
        <button
          type="button"
          aria-label={`清除${label}`}
          onClick={onClear}
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            border: 0,
            borderRadius: "50%",
            background: "rgba(0, 0, 0, 0.7)",
            color: "rgba(255, 255, 255, 0.85)",
            cursor: "pointer",
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={11} />
        </button>
      ) : null}
      {onPick ? (
        <button
          type="button"
          aria-label={`从画布选择${label}`}
          onClick={onPick}
          style={{
            position: "absolute",
            right: -8,
            bottom: -8,
            width: 20,
            height: 20,
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: "50%",
            background: "var(--tc-bg-surface)",
            color: "var(--tc-text-secondary)",
            cursor: "pointer",
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ImageIcon size={11} />
        </button>
      ) : null}
    </div>
  );
}

// 底部 Dock 里的素材缩略图，点击弹预览（IK6M68），右上角带删除按钮
export function DockMediaThumb({
  item,
  onRemove,
  onPreview,
}: {
  item: DockMediaItem;
  onRemove?: (id: string) => void;
  /** 点击缩略图预览素材（图片放大 / 视频可播 / 音频占位）。 */
  onPreview?: (item: DockMediaItem) => void;
}) {
  // Product API 内容地址需要身份；公网 TOS 与本地 blob/data URL 必须直显，
  // 否则 apiFetch 注入的产品 Authorization 会被对象存储当成非法签名。
  const protectedUrl = item.src?.startsWith("/api/projects/") ? item.src : null;
  const imageStyle = {
    width: 44,
    height: 44,
    borderRadius: 9,
    objectFit: "cover",
    flexShrink: 0,
    display: "block",
    border: "1px solid rgba(255, 255, 255, 0.08)",
  } as const;
  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        cursor: onPreview ? "pointer" : undefined,
      }}
      onClick={() => onPreview?.(item)}
      title={onPreview ? "点击预览" : undefined}
    >
      {item.type === "video" ? (
        <video
          src={item.src}
          title={item.name}
          aria-label={item.name}
          preload="metadata"
          muted
          playsInline
          style={imageStyle}
        />
      ) : protectedUrl ? (
        <AuthenticatedImage
          accessUrl={protectedUrl}
          alt={item.name}
          title={item.name}
          draggable={false}
          style={imageStyle}
        />
      ) : (
        <img
          src={item.src}
          alt={item.name}
          title={item.name}
          draggable={false}
          style={imageStyle}
        />
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`移除 ${item.name}`}
          onClick={(e) => {
            // 删除不触发预览（外层 div 的 onClick）
            e.stopPropagation();
            onRemove(item.id);
          }}
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: 0,
            background: "rgba(0, 0, 0, 0.7)",
            color: "rgba(255, 255, 255, 0.85)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            zIndex: 1,
            backdropFilter: "blur(4px)",
          }}
        >
          <X width={10} height={10} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

/** 放大/收起切换按钮（IK5OWV，方案 B）：hover 高亮 + 轻微上浮投影。 */
export function ExpandToggleButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={expanded ? "收起面板" : "放大面板"}
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        border: 0,
        background: hovered ? "var(--tc-dock-control-hover-bg)" : "transparent",
        color: hovered
          ? "var(--tc-dock-text-strong)"
          : "var(--tc-dock-text-faint)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transform: hovered ? "translateY(-1px) scale(1.08)" : "none",
        boxShadow: hovered ? "0 2px 8px rgba(0, 0, 0, 0.3)" : "none",
        transition: "all 120ms ease",
      }}
    >
      {expanded ? (
        <Minimize2 width={13} height={13} />
      ) : (
        <Maximize2 width={13} height={13} />
      )}
    </button>
  );
}

/**
 * IK74V6：生成数量选择浮层（从 ImageDockContent 下沉）。
 * fixed 定位 portal 到 body；候选数量受能力表 quantity_max 约束。
 */
export function QuantityMenu({
  menuRef,
  pos,
  quantityMax,
  quantities,
  selected,
  onSelect,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  pos: { left: number; bottom: number };
  quantityMax: number;
  quantities: string[];
  selected: string;
  onSelect: (q: string) => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      data-tc-dock-popover=""
      role="listbox"
      aria-label="选择生成数量"
      style={{
        position: "fixed",
        left: pos.left,
        bottom: pos.bottom,
        width: "max-content",
        minWidth: 120,
        padding: "4px 8px",
        borderRadius: 8,
        background: "rgb(30, 30, 30)",
        border: "1px solid rgba(255, 255, 255, 0.04)",
        boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 16px",
        zIndex: 2147483602,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        boxSizing: "border-box",
        opacity: 1,
        transform: "scale(1) translateY(0px)",
        transformOrigin: "left bottom",
        transition: "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {quantities.filter((q) => parseInt(q, 10) <= quantityMax).map((q) => {
        const isSel = q === selected;
        return (
          <button
            key={q}
            type="button"
            role="option"
            aria-selected={isSel}
            onClick={() => onSelect(q)}
            style={{
              width: "100%",
              padding: "7px 10px",
              border: 0,
              borderRadius: 6,
              background: isSel ? "rgba(255, 255, 255, 0.08)" : "transparent",
              color: isSel ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.45)",
              fontSize: 12,
              lineHeight: "16px",
              fontWeight: isSel ? 500 : 400,
              cursor: "pointer",
              textAlign: "left",
              whiteSpace: "nowrap",
              transition: "background 80ms",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {q}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
