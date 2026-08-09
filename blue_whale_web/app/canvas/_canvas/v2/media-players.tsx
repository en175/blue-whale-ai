"use client";

// IK74V6：画布节点媒体播放器（从 nodes.tsx 下沉）。
/**
 * v2 节点组件 —— 复刻老 CanvasNodes 展示（VideoPlayer/MediaStateBody/节点/NodeToolbar/resize），
 * 数据源切 store（assetId 查 assets.src）。样式 CSS 类与老一致（DESIGN token）。
 */
"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  AtSign,
  AudioLines,
  Image as ImageIcon,
  Info,
  Loader2,
  Music,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  Video as VideoIcon,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  useHandleConnections,
  useNodesData,
  type NodeProps,
} from "@xyflow/react";
import { useCanvasStore } from "../store";
import type {
  CanvasNode,
  CanvasNodeData,
  NodeKindId,
  NodeOrigin,
  NodeStatus,
  MediaKind,
} from "../model";
import { richDocToPlainText, isEmptyRichDoc } from "../model";
import { nodeKinds } from "../kinds";
import {
  REFERENCE_CARD_TYPES,
  REFERENCE_CARD_WIDTH,
  referenceCardHeight,
} from "../constants";
import type { ReferenceCardType } from "../model";
import {
  NODE_TOOLBAR_ACTIONS,
  NODE_TOOLBAR_VIDEO_ACTIONS,
  toolbarForKind,
  type NodeToolbarAction,
} from "../config";
import { AuthenticatedImage } from "../components/AuthenticatedImage";
import { UploadCardBody } from "./uploadCard";
import {
  ProductDetailSection,
  ProductImageSection,
  ProductLinkImportSection,
} from "./product-card-sections";
import { useInlineEdit } from "./useInlineEdit";
import { EditorContent } from "@tiptap/react";
import { useRichEditor, plainTextToDoc } from "./text/RichTextEditor";
import { TextFormatToolbar } from "./text/TextFormatToolbar";
import { ExpandModal } from "./text/ExpandModal";
import type { TextMentionItem } from "./text/types";

export function isVideoUrl(u?: string): boolean {
  return !!u && /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i.test(u);
}
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? `${h}:${mm}` : `${m}`) + `:${String(r).padStart(2, "0")}`;
}
export function VideoPlayer({ src, label }: { src: string; label?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  // 首帧就绪前显占位防黑屏（IJZY0Z「视频节点能显示首帧封面」）；src 变化重置
  const [frameReady, setFrameReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setFrameReady(false), [src]);
  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const seekTo = useCallback(
    (clientX: number) => {
      const v = videoRef.current;
      const bar = barRef.current;
      if (!v || !bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      v.currentTime = ratio * duration;
    },
    [duration],
  );
  const ratio = duration > 0 ? Math.min(1, current / duration) : 0;
  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        muted={muted}
        aria-label={label || "视频"}
        className="h-full w-full rounded-lg object-contain"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onLoadedData={() => setFrameReady(true)}
      />
      {!frameReady && (
        <div
          data-testid="video-frame-pending"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ color: "var(--tc-text-muted)" }}
        >
          <VideoIcon
            width={40}
            height={40}
            stroke="currentColor"
            strokeWidth={1}
          />
        </div>
      )}
      <div
        className="nodrag nopan absolute inset-x-0 bottom-0 flex items-center gap-2 rounded-b-lg px-2 py-1.5"
        style={{ background: "var(--tc-bg-overlay)" }}
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "暂停" : "播放"}
          className="flex h-4 w-4 shrink-0 items-center justify-center"
          style={{ color: "var(--tc-text-secondary)" }}
        >
          {playing ? (
            <Pause width={12} height={12} fill="currentColor" stroke="none" />
          ) : (
            <Play width={12} height={12} fill="currentColor" stroke="none" />
          )}
        </button>
        <div
          ref={barRef}
          onPointerDown={(e) => {
            draggingRef.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            seekTo(e.clientX);
          }}
          onPointerMove={(e) => draggingRef.current && seekTo(e.clientX)}
          onPointerUp={(e) => {
            draggingRef.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          className="relative h-1.5 flex-1 cursor-pointer rounded-full"
          style={{ background: "var(--tc-bg-elevated)" }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${ratio * 100}%`, background: "var(--tc-accent)" }}
          />
        </div>
        <span
          className="shrink-0 text-[10px] tabular-nums"
          style={{ color: "var(--tc-text-tertiary)" }}
        >
          {formatTime(current)} / {formatTime(duration)}
        </span>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "取消静音" : "静音"}
          className="flex h-4 w-4 shrink-0 items-center justify-center"
          style={{ color: "var(--tc-text-secondary)" }}
        >
          {muted ? (
            <VolumeX width={12} height={12} />
          ) : (
            <Volume2 width={12} height={12} />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * 音频节点播放器（IK55VM）：封面（图标占位）+ 播放条（播放/暂停 + 进度 + 时长），不做波形。
 * 隐藏原生 `<audio>`（shadow DOM 无法隔离 RF 拖拽），控制条 nodrag/nopan 隔离（同 VideoPlayer）。
 */
export function AudioPlayer({ src, label }: { src: string; label?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, []);
  const seekTo = useCallback(
    (clientX: number) => {
      const a = audioRef.current;
      const bar = barRef.current;
      if (!a || !bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      a.currentTime = ratio * duration;
    },
    [duration],
  );
  const ratio = duration > 0 ? Math.min(1, current / duration) : 0;
  return (
    <div
      data-testid="node-audio-player"
      className="flex h-full w-full flex-col"
      style={{ color: "var(--tc-text-secondary)" }}
    >
      {/* 封面区（mock 无封面图，图标占位） */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center"
        style={{
          backgroundImage:
            "linear-gradient(135deg, var(--tc-bg-elevated) 0%, var(--tc-bg-surface) 60%, var(--tc-bg-elevated) 100%)",
          color: "var(--tc-text-tertiary)",
        }}
      >
        <AudioLines
          width={28}
          height={28}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        aria-label={label || "音频"}
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
      />
      {/* 播放条 */}
      <div className="nodrag nopan flex w-full items-center gap-2 px-3 pb-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "暂停" : "播放"}
          className="flex h-4 w-4 shrink-0 items-center justify-center"
          style={{ color: "var(--tc-text-secondary)" }}
        >
          {playing ? (
            <Pause width={12} height={12} fill="currentColor" stroke="none" />
          ) : (
            <Play width={12} height={12} fill="currentColor" stroke="none" />
          )}
        </button>
        <div
          ref={barRef}
          onPointerDown={(e) => {
            draggingRef.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            seekTo(e.clientX);
          }}
          onPointerMove={(e) => draggingRef.current && seekTo(e.clientX)}
          onPointerUp={(e) => {
            draggingRef.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          className="relative h-1.5 flex-1 cursor-pointer rounded-full"
          style={{ background: "var(--tc-bg-elevated)" }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${ratio * 100}%`, background: "var(--tc-accent)" }}
          />
        </div>
        <span
          className="shrink-0 text-[10px] tabular-nums"
          style={{ color: "var(--tc-text-tertiary)" }}
        >
          {formatTime(current)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}
