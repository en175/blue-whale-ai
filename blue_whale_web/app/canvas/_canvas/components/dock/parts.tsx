/**
 * Dock Parts —— Dock 共享部件（展示层）
 * MediaUploadButton：素材上传按钮；FrameUploadButton：首尾帧上传按钮；
 * DockMediaThumb：素材缩略图（含删除）。供 ImageDockContent / VideoDockContent 复用。
 */
import { X } from "lucide-react";
import { IconPlus } from "../../icons";
import type { DockMediaItem } from "../../types";
import { AuthenticatedImage } from "../AuthenticatedImage";

export function MediaUploadButton({
  label,
  accept,
  icon,
}: {
  label: string;
  accept: string;
  icon: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <input
        type="file"
        accept={accept}
        multiple
        aria-hidden="true"
        style={{ display: "none" }}
      />
      <button
        type="button"
        aria-label={label}
        style={{
          width: 44,
          height: 44,
          borderRadius: 9,
          border: "1px solid rgba(255, 255, 255, 0.02)",
          background: "rgba(255, 255, 255, 0.043)",
          color: "rgba(255, 255, 255, 0.62)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: 0,
          cursor: "pointer",
          opacity: 1,
          transition: "background 120ms, color 120ms",
          flexShrink: 0,
        }}
      >
        {icon}
      </button>
    </div>
  );
}

export function FrameUploadButton({ label }: { label: string }) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <input
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        aria-hidden="true"
        style={{ display: "none" }}
      />
      <button
        type="button"
        aria-label={label}
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
        <span style={{ opacity: 0.4, flexShrink: 0 }}>
          <IconPlus size={14} />
        </span>
        <span style={{ color: "rgba(255, 255, 255, 0.25)" }}>{label}</span>
      </button>
    </div>
  );
}

// 底部 Dock 里的素材缩略图，带右上角删除按钮
export function DockMediaThumb({
  item,
  onRemove,
}: {
  item: DockMediaItem;
  onRemove?: (id: string) => void;
}) {
  // 参考图身份以不可变 assetId 为准：有 Asset 身份的 src 即受保护 access_url，
  // 必须复用带身份媒体读取（裸 <img> 无身份稳定 401）；
  // 本地上传项无 assetId、src 为本地临时 URL（blob:/data:）：直显，不走带身份读取。
  const protectedUrl = item.assetId && item.src ? item.src : null;
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
    <div style={{ position: "relative", flexShrink: 0 }}>
      {protectedUrl ? (
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
          onClick={() => onRemove(item.id)}
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
