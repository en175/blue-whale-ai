/**
 * Dock Parts —— Dock 共享部件（展示层）
 * DockMediaThumb：素材缩略图（点击预览 + 删除）。供 ImageDockContent / VideoDockContent / AudioDockContent 复用。
 */
import { useRef } from "react";
import { Image as ImageIcon, X } from "lucide-react";
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
