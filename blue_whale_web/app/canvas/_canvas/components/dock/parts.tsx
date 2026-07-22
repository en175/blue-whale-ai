/**
 * Dock Parts —— Dock 共享部件（展示层）
 * FrameUploadButton：首尾帧上传按钮；
 * DockMediaThumb：素材缩略图（含删除）。供 ImageDockContent / VideoDockContent 复用。
 */
import { useEffect, useRef, useState } from "react";
import { AudioLines, Video, X } from "lucide-react";
import { IconPlus } from "../../icons";
import type { DockMediaItem } from "../../types";

export function FrameUploadButton({
  label,
  value,
  onPick,
  onClear,
}: {
  label: string;
  /** 已上传帧的 TOS url；有值显示缩略图，无值显示上传占位。 */
  value?: string;
  onPick?: (file: File) => void;
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
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick?.(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label={value ? `${label}已上传，点击更换` : `上传${label}`}
        onClick={() => inputRef.current?.click()}
        style={{
          width: 48,
          height: 48,
          aspectRatio: "1 / 1",
          padding: 0,
          boxSizing: "border-box",
          borderRadius: 12,
          flexShrink: 0,
          border: value
            ? "1px solid rgba(255, 255, 255, 0.12)"
            : "1.5px dashed rgba(255, 255, 255, 0.08)",
          background: "rgba(255, 255, 255, 0.04)",
          color: "rgba(255, 255, 255, 0.3)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          transition: "120ms",
        }}
      >
        {value ? (
          <img
            src={value}
            alt={label}
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              fontSize: 9,
              fontWeight: 500,
            }}
          >
            <span style={{ opacity: 0.4, flexShrink: 0 }}>
              <IconPlus size={14} />
            </span>
            <span style={{ color: "rgba(255, 255, 255, 0.25)" }}>{label}</span>
          </div>
        )}
      </button>
      {value && onClear && (
        <button
          type="button"
          aria-label={`移除${label}`}
          onClick={onClear}
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

const thumbBoxStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 9,
  flexShrink: 0,
  display: "block",
  border: "1px solid rgba(255, 255, 255, 0.08)",
};

/**
 * VideoThumb —— 隐藏 <video> 加载首帧 → canvas 绘制 → 显示首帧缩略图。
 * <video> 做缩略图浏览器不主动解码帧；canvas 提取可保证跨浏览器一致。
 * video 元素必须挂 DOM 中才触发加载，故 render 隐藏 video + canvas 并用 ref 联动。
 */
function VideoThumb({ src, name }: { src: string; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let cancelled = false;

    const seekAndDraw = () => {
      if (cancelled || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0);
          console.debug("[DEBUG-vthumb] drawImage ok", src.slice(-40));
        } catch (e) {
          console.debug("[DEBUG-vthumb] drawImage tainted", src.slice(-40), e);
        }
      }
      setReady(true);
    };

    const onLoadedData = () => {
      console.debug("[DEBUG-vthumb] loadeddata", src.slice(-40));
      video.currentTime = 0.1;
    };

    const onSeeked = () => {
      console.debug("[DEBUG-vthumb] seeked", video.videoWidth, "x", video.videoHeight, src.slice(-40));
      seekAndDraw();
    };

    const onError = () => {
      console.debug("[DEBUG-vthumb] error", src.slice(-40));
      if (!cancelled) setFallback(true);
    };

    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    // 已在 DOM 中，直接触发加载
    if (video.readyState >= 2) {
      // 已经 loadeddata
      onLoadedData();
    }

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
  }, [src]);

  if (fallback) {
    console.debug("[DEBUG-vthumb] fallback icon", src.slice(-40));
    return (
      <div title={name} style={{ ...thumbBoxStyle, background: "rgba(255, 255, 255, 0.04)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255, 255, 255, 0.5)" }}>
        <Video width={18} height={18} />
      </div>
    );
  }

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        preload="auto"
        muted
        playsInline
        style={{ display: "none" }}
      />
      <canvas
        ref={canvasRef}
        title={name}
        style={{
          ...thumbBoxStyle,
          objectFit: "cover",
          background: "rgba(255, 255, 255, 0.04)",
          visibility: ready ? "visible" : "hidden",
        }}
      />
    </>
  );
  );
}

// 底部 Dock 里的素材缩略图，按类型渲染（图片缩略图 / 视频·音频图标），带右上角删除按钮。
// 点击可预览（onPreview），上传中显示进度百分比。
export function DockMediaThumb({
  item,
  onRemove,
  onPreview,
}: {
  item: DockMediaItem;
  onRemove?: (id: string) => void;
  onPreview?: (item: DockMediaItem) => void;
}) {
  const uploading = typeof item.uploadProgress === "number" && item.uploadProgress < 100;

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={uploading ? `上传中 ${item.uploadProgress}%` : `预览 ${item.name}`}
        onClick={() => onPreview?.(item)}
        disabled={uploading}
        style={{
          padding: 0,
          border: 0,
          background: "transparent",
          cursor: uploading ? "default" : "pointer",
          display: "block",
        }}
      >
        {uploading ? (
          // 上传中：灰色占位 + 百分比
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 9,
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255, 255, 255, 0.55)",
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {item.uploadProgress}%
          </div>
        ) : item.type === "image" ? (
          <img
            src={item.src}
            alt={item.name}
            title={item.name}
            draggable={false}
            style={{
              width: 44,
              height: 44,
              borderRadius: 9,
              objectFit: "cover",
              flexShrink: 0,
              display: "block",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          />
        ) : item.type === "video" && item.src ? (
          <VideoThumb src={item.src} name={item.name} />
        ) : (
          <div
            title={item.name}
            style={{
              width: 44,
              height: 44,
              borderRadius: 9,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255, 255, 255, 0.5)",
              flexShrink: 0,
            }}
          >
            {item.type === "video" ? <Video width={18} height={18} /> : <AudioLines width={18} height={18} />}
          </div>
        )}
      </button>
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

const mediaSectionBtnStyle: React.CSSProperties = {
  height: 28,
  padding: "0 12px",
  borderRadius: 6,
  border: "1px solid rgba(255, 255, 255, 0.08)",
  background: "rgba(255, 255, 255, 0.04)",
  color: "rgba(255, 255, 255, 0.7)",
  fontSize: 12,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 120ms",
};

/**
 * MediaCategoryButton —— 素材分类图标触发按钮（图片 / 视频 / 音频）。
 * 收起态仅显示图标，点击展开对应 MediaSection 浮层（由调用方 createPortal 渲染）。
 */
export function MediaCategoryButton({
  triggerRef,
  icon,
  label,
  active,
  hasItems,
  onClick,
}: {
  triggerRef: React.Ref<HTMLButtonElement>;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  hasItems: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={active}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        border: 0,
        background: active ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.04)",
        color: hasItems ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.5)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "background 120ms, color 120ms",
      }}
    >
      {icon}
    </button>
  );
}

/**
 * MediaSection —— 单类素材上传区（图片 / 视频 / 音频）。
 * 规格行 + 计数行（Uploaded/单类上限 · Total/总上限）+ 已传缩略图 + 本地上传/从画布选择。
 * 满额时本地上传禁用（从画布选择仍可，由上层决定是否拦截）。
 */
export function MediaSection({
  spec,
  accept,
  items,
  onRemove,
  onUpload,
  onPickFromCanvas,
  onPreview,
  uploadedMax,
  total,
  totalMax,
}: {
  spec: string;
  accept: string;
  items: DockMediaItem[];
  onRemove?: (id: string) => void;
  onUpload?: (file: File) => void;
  onPickFromCanvas?: () => void;
  onPreview?: (item: DockMediaItem) => void;
  uploadedMax: number;
  total: number;
  totalMax: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploaded = items.length;
  const full = uploaded >= uploadedMax || total >= totalMax;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.4)", lineHeight: 1.4 }}>{spec}</div>
      <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.4)", lineHeight: 1.4 }}>
        Uploaded: {uploaded}/{uploadedMax} · Total: {total}/{totalMax}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-hidden="true"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload?.(f);
          e.target.value = "";
        }}
      />
      {items.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {items.map((m) => (
            <DockMediaThumb key={m.id} item={m} onRemove={onRemove} onPreview={onPreview} />
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={full}
          onClick={() => inputRef.current?.click()}
          style={{
            ...mediaSectionBtnStyle,
            opacity: full ? 0.4 : 1,
            cursor: full ? "not-allowed" : "pointer",
          }}
        >
          本地上传
        </button>
        <button type="button" onClick={onPickFromCanvas} style={mediaSectionBtnStyle}>
          从画布选择
        </button>
      </div>
    </div>
  );
}
