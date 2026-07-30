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
  AudioLines,
  Image as ImageIcon,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Video as VideoIcon,
  Volume2,
  VolumeX,
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
  NodeStatus,
  MediaKind,
} from "../model";
import { nodeKinds } from "../kinds";
import {
  NODE_TOOLBAR_ACTIONS,
  NODE_TOOLBAR_VIDEO_ACTIONS,
  toolbarForKind,
  type NodeToolbarAction,
} from "../config";
import { AuthenticatedImage } from "../components/AuthenticatedImage";
import { AssetInfoPanel } from "../components/AssetInfoPanel";

type MediaNodeData = CanvasNodeData & {
  content?: string;
  errorMessage?: string;
  progress?: number;
};

type NodeActionsCtx = {
  onAction?: (id: string, actionId: string) => void;
  onRetry?: (id: string) => void;
  onEditPrompt?: (id: string, text: string) => void;
  picking?: boolean;
  pickingAccept?: MediaKind[];
};
export const NodeActionsContext = createContext<NodeActionsCtx>({});

function isVideoUrl(u?: string): boolean {
  return !!u && /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i.test(u);
}
function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? `${h}:${mm}` : `${m}`) + `:${String(r).padStart(2, "0")}`;
}

function VideoPlayer({ src, label }: { src: string; label?: string }) {
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
 * 音频节点播放器（IJZXW7-B）：无画面，AudioLines 图标 + 自定义控制条（播放/暂停 + 进度 + 时长）。
 * 隐藏原生 `<audio>`（shadow DOM 无法隔离 RF 拖拽），控制条 nodrag/nopan 隔离（同 VideoPlayer）。
 */
function AudioPlayer({ src, label }: { src: string; label?: string }) {
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
      className="flex h-full w-full flex-col items-center justify-center gap-2 px-3"
      style={{ color: "var(--tc-text-secondary)" }}
    >
      <AudioLines
        width={28}
        height={28}
        stroke="currentColor"
        strokeWidth={1.5}
      />
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
      <div className="nodrag nopan flex w-full items-center gap-2">
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

type MediaStateBodyProps = {
  kind: "image" | "video" | "audio";
  status?: NodeStatus;
  src?: string;
  content?: string;
  errorMessage?: string;
  progress?: number;
  onRetry?: () => void;
};
export function MediaStateBody({
  kind,
  status,
  src,
  content,
  errorMessage,
  progress,
  onRetry,
}: MediaStateBodyProps) {
  if (status === "error") {
    return (
      <div
        data-testid="node-error"
        className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        <AlertCircle
          width={28}
          height={28}
          stroke="var(--tc-destructive)"
          strokeWidth={1.5}
        />
        <span
          className="text-xs leading-4"
          style={{ color: "var(--tc-text-tertiary)" }}
        >
          {errorMessage || "生成失败"}
        </span>
        <button
          type="button"
          data-testid="node-retry"
          onClick={onRetry}
          className="tc-ui-glow-btn mt-1 flex items-center gap-1 rounded-full px-3 py-1 text-xs"
          style={{
            border: "1px solid var(--tc-border)",
            background: "var(--tc-bg-elevated)",
            color: "var(--tc-text-secondary)",
          }}
        >
          <RefreshCw width={12} height={12} stroke="currentColor" />
          重试
        </button>
      </div>
    );
  }
  if (status === "running") {
    const showProgress =
      kind === "video" && typeof progress === "number" && progress >= 0;
    return (
      <div
        data-testid="node-loading"
        className="flex h-full w-full flex-col items-center justify-center gap-2"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        <Loader2
          width={28}
          height={28}
          stroke="currentColor"
          strokeWidth={1.5}
          className="animate-spin"
        />
        <span
          className="text-xs leading-4"
          style={{ color: "var(--tc-text-tertiary)" }}
        >
          {showProgress
            ? `处理中 ${Math.round(progress as number)}%`
            : "处理中…"}
        </span>
      </div>
    );
  }
  // audio：有 src 可播放（AudioPlayer 播放/暂停+进度+时长）；无 src 占位（图标+名）
  if (kind === "audio") {
    if (src) return <AudioPlayer src={src} label={content} />;
    return (
      <div
        data-testid="node-audio"
        className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        <AudioLines
          width={32}
          height={32}
          stroke="currentColor"
          strokeWidth={1.5}
        />
        <span
          className="max-w-full truncate text-xs leading-4"
          style={{ color: "var(--tc-text-tertiary)" }}
        >
          {content || "音频节点"}
        </span>
      </div>
    );
  }
  if (src) {
    if (kind === "video" || isVideoUrl(src)) {
      return <VideoPlayer src={src} label={content} />;
    }
    if (src.startsWith("/api/projects/")) {
      return (
        <AuthenticatedImage
          accessUrl={src}
          alt={content || "图片"}
          className="h-full w-full rounded-lg object-contain"
          draggable={false}
        />
      );
    }
    return (
      <img
        src={src}
        alt={content || "图片"}
        className="h-full w-full rounded-lg object-contain"
        draggable={false}
      />
    );
  }
  return (
    <div
      data-testid="node-empty"
      className="flex h-full w-full items-center justify-center"
      style={{ color: "var(--tc-text-muted)" }}
    >
      <ImageIcon width={48} height={48} stroke="currentColor" strokeWidth={1} />
    </div>
  );
}

function NodeToolbarActions({
  onAction,
  actions = NODE_TOOLBAR_ACTIONS,
  expandedActionId,
}: {
  onAction: (id: string) => void;
  actions?: NodeToolbarAction[];
  expandedActionId?: string;
}) {
  return (
    <div
      className="tc-node-toolbar flex items-center gap-1 rounded-[14px] px-2 py-1.5"
      style={{
        background: "var(--tc-bg-surface)",
        border: "1px solid var(--tc-border-subtle)",
        backdropFilter: "blur(12px)",
      }}
    >
      {actions.map((action) => {
        if (action.id === "divider")
          return (
            <div
              key="divider"
              style={{
                width: 1,
                height: 16,
                background: "var(--tc-border)",
                margin: "0 4px",
                flexShrink: 0,
              }}
            />
          );
        if (action.iconOnly)
          return (
            <button
              key={action.id}
              type="button"
              aria-label={action.label}
              aria-haspopup={action.id === "info" ? "dialog" : undefined}
              aria-expanded={
                action.id === "info"
                  ? expandedActionId === action.id
                  : undefined
              }
              onClick={() => onAction(action.id)}
              className="tc-node-toolbar-button tc-ui-glow-btn flex items-center justify-center rounded-lg hover:bg-[var(--tc-menu-item-hover)] hover:text-white"
              style={{
                width: 32,
                height: 32,
                padding: 0,
                border: 0,
                background: "transparent",
                color: "var(--tc-text-secondary)",
              }}
            >
              {action.icon}
            </button>
          );
        return (
          <button
            key={action.id}
            type="button"
            aria-label={action.label}
            onClick={() => onAction(action.id)}
            className="tc-node-toolbar-button tc-ui-glow-btn flex items-center gap-1.5 rounded-lg hover:bg-[var(--tc-menu-item-hover)] hover:text-white"
            style={{
              height: 32,
              padding: "0 8px",
              border: 0,
              background: "transparent",
              color: "var(--tc-text-secondary)",
            }}
          >
            {action.icon}
            <span
              className="whitespace-nowrap"
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.02em",
                lineHeight: "16px",
              }}
            >
              {action.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function useNodeAsset(data: MediaNodeData) {
  const assetId = data.assetId;
  return useCanvasStore((s) => (assetId ? s.assets[assetId] : undefined));
}

/** 工作流连线 UI 总开关：false = 隐藏 Handle（数据结构 edges/ports/engine 保留，恢复改 true）。 */
const SHOW_WORKFLOW_UI = false;

/** 按 nodeKinds[kind].inputs/outputs 动态渲染 Handle（registry 驱动，非硬编码）。 */
function NodeHandles({ kind }: { kind: NodeKindId }) {
  if (!SHOW_WORKFLOW_UI) return null;
  const spec = nodeKinds[kind];
  const style = {
    width: 10,
    height: 10,
    background: "var(--tc-accent)",
    border: "2px solid var(--tc-bg-surface)",
  };
  return (
    <>
      {spec.inputs.map((p) => (
        <Handle
          key={`in-${p.id}`}
          type="target"
          position={Position.Left}
          id={p.id}
          style={style}
          className="tc-node-handle nodrag"
        />
      ))}
      {spec.outputs.map((p) => (
        <Handle
          key={`out-${p.id}`}
          type="source"
          position={Position.Right}
          id={p.id}
          style={style}
          className="tc-node-handle nodrag"
        />
      ))}
    </>
  );
}

export function MediaNode({ id, data, width, height, selected }: NodeProps) {
  const d = data as unknown as MediaNodeData;
  const { onAction, onRetry, picking, pickingAccept } =
    useContext(NodeActionsContext);
  const asset = useNodeAsset(d);
  const ensureAsset = useCanvasStore((s) => s.ensureAsset);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const src = asset?.src ?? (d.imageUrl as string | undefined);
  const isAudio = d.kind === "audio";
  const isVideo = !isAudio && (d.kind === "video" || isVideoUrl(src));
  const renderKind: "audio" | "video" | "image" = isAudio
    ? "audio"
    : isVideo
      ? "video"
      : "image";
  const pickable =
    picking &&
    (pickingAccept?.includes(d.kind as MediaKind) ?? true) &&
    !!d.assetId &&
    d.status !== "running" &&
    d.status !== "error";
  // prompt 来源：prompt handle 连的上游 text 节点 prompt（连线驱动，富文本标签展示）
  const promptConns = useHandleConnections({ type: "target", id: "prompt" });
  const upstream = useNodesData(promptConns.map((c) => c.source)) as unknown as
    CanvasNode[] | undefined;
  const promptFromText = upstream?.find((n) => n.data.kind === "text")?.data
    .prompt as string | undefined;
  useEffect(() => {
    if (!infoOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setInfoOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInfoOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [infoOpen]);
  const handleToolbarAction = useCallback(
    (actionId: string) => {
      if (actionId !== "info") {
        setInfoOpen(false);
        onAction?.(id, actionId);
        return;
      }
      const nextOpen = !infoOpen;
      setInfoOpen(nextOpen);
      if (!nextOpen || !d.assetId || asset?.mimeType) return;
      setInfoLoading(true);
      void ensureAsset(d.assetId)
        .catch(() => undefined)
        .finally(() => setInfoLoading(false));
    },
    [asset?.mimeType, d.assetId, ensureAsset, id, infoOpen, onAction],
  );
  return (
    <>
      <NodeToolbar
        position={Position.Top}
        offset={8}
        isVisible={selected && d.status !== "running"}
      >
        <div ref={toolbarRef} className="nodrag nopan relative">
          <NodeToolbarActions
            actions={toolbarForKind(d.kind)}
            expandedActionId={infoOpen ? "info" : undefined}
            onAction={handleToolbarAction}
          />
          {infoOpen && (
            <AssetInfoPanel asset={asset} loading={infoLoading} />
          )}
        </div>
      </NodeToolbar>
      <div
        className={[
          "tc-image-node__media group relative overflow-visible rounded-lg",
          pickable ? "tc-canvas-pickable" : "",
        ].join(" ")}
        style={{
          width,
          height,
          outline: selected
            ? "2px solid var(--tc-card-selected-stroke)"
            : "2px solid transparent",
          outlineOffset: 0,
          border: "1px solid var(--tc-border)",
          boxShadow: selected
            ? "var(--tc-card-selected-shadow)"
            : "var(--tc-card-hover-shadow)",
          background: "var(--tc-bg-elevated)",
        }}
        role="img"
        aria-label={d.content || d.kind}
      >
        <NodeResizer
          nodeId={id}
          isVisible={selected}
          minWidth={40}
          minHeight={40}
          keepAspectRatio
          handleClassName="tc-node-resize-handle"
        />
        <NodeHandles kind={d.kind} />
        {pickable && (
          <span className="tc-canvas-pickable-badge" aria-hidden="true">
            <Plus width={13} height={13} strokeWidth={2.5} />
          </span>
        )}
        <div
          className={`nodrag absolute -top-6 left-0 flex items-center text-xs font-normal leading-4 select-none transition-opacity duration-150 ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          style={{ width, background: "transparent" }}
        >
          <div
            className="flex min-w-0 flex-1 items-center gap-[5px]"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            {isAudio ? (
              <AudioLines width={13} height={13} stroke="currentColor" />
            ) : isVideo ? (
              <VideoIcon width={13} height={13} stroke="currentColor" />
            ) : (
              <ImageIcon width={13} height={13} stroke="currentColor" />
            )}
            <span className="tc-node-label-bar__name relative inline-block max-w-[216px] cursor-text overflow-hidden text-ellipsis whitespace-nowrap">
              {d.content || `${d.kind}节点`}
            </span>
          </div>
        </div>
        <MediaStateBody
          kind={renderKind}
          status={d.status}
          src={src}
          content={d.content}
          errorMessage={d.errorMessage}
          progress={d.progress}
          onRetry={() => onRetry?.(id)}
        />
        {promptFromText && (
          <div
            className="nodrag absolute -bottom-7 left-0 max-w-full truncate rounded px-1.5 py-0.5 text-[10px] leading-tight"
            style={{
              background: "var(--tc-bg-surface)",
              color: "var(--tc-text-tertiary)",
              border: "1px solid var(--tc-border-subtle)",
            }}
          >
            <Sparkles
              width={9}
              height={9}
              className="mr-0.5 inline-block align-text-bottom"
            />
            {promptFromText}
          </div>
        )}
      </div>
    </>
  );
}

export function TextNode({ id, data, width, height, selected }: NodeProps) {
  const d = data as unknown as CanvasNodeData & {
    content?: string;
    prompt?: string;
  };
  const { onEditPrompt } = useContext(NodeActionsContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.prompt ?? d.content ?? "");
  const [infoOpen, setInfoOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(d.prompt ?? d.content ?? "");
  }, [d.prompt, d.content]);
  useEffect(() => {
    if (!infoOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setInfoOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInfoOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [infoOpen]);
  const commit = () => {
    setEditing(false);
    onEditPrompt?.(id, draft);
  };
  return (
    <>
      <NodeToolbar
        position={Position.Top}
        offset={8}
        isVisible={selected}
      >
        <div ref={toolbarRef} className="nodrag nopan relative">
          <NodeToolbarActions
            actions={toolbarForKind("image").filter(
              (action) => action.id === "info",
            )}
            expandedActionId={infoOpen ? "info" : undefined}
            onAction={() => setInfoOpen((open) => !open)}
          />
          {infoOpen && <AssetInfoPanel />}
        </div>
      </NodeToolbar>
      <div
        className="tc-text-node relative flex items-center justify-center rounded-xl px-4"
        style={{
          width,
          height,
          outline: selected
            ? "2px solid var(--tc-card-selected-stroke)"
            : "2px solid transparent",
          outlineOffset: 0,
          background: "var(--tc-bg-surface)",
        }}
      >
        <NodeHandles kind="text" />
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              }
            }}
            rows={1}
            className="nodrag w-full resize-none bg-transparent text-center text-sm leading-5 outline-none"
            style={{ color: "var(--tc-text-secondary)" }}
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            className="cursor-text text-center text-sm leading-5"
            style={{
              color: draft ? "var(--tc-text-secondary)" : "var(--tc-text-muted)",
            }}
          >
            {draft || "双击输入 prompt"}
          </span>
        )}
      </div>
    </>
  );
}

export function GroupNode({ data }: NodeProps) {
  const d = data as unknown as CanvasNodeData;
  return (
    <div
      className="tc-group-node relative h-full w-full rounded-xl border"
      style={{ borderColor: "var(--tc-border)" }}
    >
      <NodeHandles kind="group" />
      <div
        className="px-2 py-1 text-xs"
        style={{ color: "var(--tc-text-tertiary)" }}
      >
        {d.label || "Group"}
      </div>
    </div>
  );
}
