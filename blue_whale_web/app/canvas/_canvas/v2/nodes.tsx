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
export type { TextMentionItem } from "./text/types";

type MediaNodeData = CanvasNodeData & {
  content?: string;
  errorMessage?: string;
  progress?: number;
  previewUrl?: string;
};

type NodeActionsCtx = {
  onAction?: (id: string, actionId: string) => void;
  onRetry?: (id: string) => void;
  onRemoveNode?: (id: string) => void;
  /** IK55VL 视频卡生成中取消入口：按节点 taskId 取消 GenerationJob。 */
  onCancelJob?: (id: string) => void;
  /** IK55VH 富文本卡 commit：写回 richDoc + 派生纯文本（进 prompt）。 */
  onEditRichText?: (id: string, richDoc: unknown, plainText: string) => void;
  /** IK55VS 参考卡描述 commit：写回 description。 */
  onEditDescription?: (id: string, text: string) => void;
  /** IK55VT 参考卡卡名 commit：写回 name。 */
  onEditReferenceName?: (id: string, name: string) => void;
  /** IK55VT 参考图通道二：本地上传（runtime 开 file picker，结果落该卡槽）。 */
  onUploadReferenceImage?: (id: string) => void;
  /** IK55VT 参考图通道三：打开图像生成 Dock（无预填，结果回落该卡槽）。 */
  onGenerateReferenceImage?: (id: string) => void;
  /** IK55VT 删除参考图：回空态（历史描述保留）。 */
  onRemoveReferenceImage?: (id: string) => void;
  /** IK55VT 通道一画布拖入：正被拖拽素材命中的参考卡 id（高亮落槽提示）。 */
  referenceDropTargetId?: string | null;
  /** IK55VZ 商品卡详情 commit：写回 detail。 */
  onEditProductDetail?: (id: string, text: string) => void;
  /** IK55VZ 商品卡移除单张图：从 imageAssetIds 摘除 assetId。 */
  onRemoveProductImage?: (id: string, assetId: string) => void;
  /** IK55VZ 商品卡链接导入：runtime mock 解析填充图片/详情/来源链接。 */
  onImportProductLink?: (id: string, url: string) => void;
  /** IK55VH 富文本卡 @ 建议素材列表。 */
  mentionItems?: TextMentionItem[];
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
 * 音频节点播放器（IK55VM）：封面（图标占位）+ 播放条（播放/暂停 + 进度 + 时长），不做波形。
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

type MediaStateBodyProps = {
  kind: "image" | "video" | "audio";
  status?: NodeStatus;
  src?: string;
  content?: string;
  errorMessage?: string;
  progress?: number;
  /** 产物来源（recipe.origin）；uploaded 的 running/error 走上传占位卡（IK55VE 变体 C）。 */
  origin?: NodeOrigin;
  /** 上传占位卡本地缩略图（object URL，不持久化）。 */
  previewUrl?: string;
  onRetry?: () => void;
  onRemove?: () => void;
  /** IK55VL 生成中取消入口（仅视频生成卡提供；hover 显示）。 */
  onCancel?: () => void;
};
export function MediaStateBody({
  kind,
  status,
  src,
  content,
  errorMessage,
  progress,
  origin,
  previewUrl,
  onRetry,
  onRemove,
  onCancel,
}: MediaStateBodyProps) {
  // 上传占位卡：仅 uploaded 来源的 running/error；生成卡外观保持原样
  if (origin === "uploaded" && (status === "running" || status === "error")) {
    return (
      <UploadCardBody
        kind={kind}
        status={status}
        progress={progress}
        errorMessage={errorMessage}
        previewUrl={previewUrl}
        onRetry={onRetry}
        onRemove={onRemove}
      />
    );
  }
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
        {onCancel && (
          <button
            type="button"
            aria-label="取消生成"
            onClick={onCancel}
            className="nodrag absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
            style={{
              background: "var(--tc-bg-surface)",
              border: "1px solid var(--tc-border-subtle)",
              color: "var(--tc-text-secondary)",
            }}
          >
            <X width={12} height={12} stroke="currentColor" />
          </button>
        )}
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
}: {
  onAction: (id: string) => void;
  actions?: NodeToolbarAction[];
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
  const {
    onAction,
    onRetry,
    onRemoveNode,
    onCancelJob,
    picking,
    pickingAccept,
  } = useContext(NodeActionsContext);
  const asset = useNodeAsset(d);
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
  return (
    <>
      <NodeToolbar
        position={Position.Top}
        offset={8}
        isVisible={selected && d.status !== "running"}
      >
        <NodeToolbarActions
          actions={toolbarForKind(d.kind)}
          onAction={(a) => onAction?.(id, a)}
        />
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
          origin={d.recipe?.origin}
          previewUrl={d.previewUrl}
          onRetry={() => onRetry?.(id)}
          onRemove={() => onRemoveNode?.(id)}
          onCancel={
            d.status === "running" && renderKind === "video" && d.taskId
              ? () => onCancelJob?.(id)
              : undefined
          }
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

/**
 * IK55VH 富文本卡（三态状态机，移植自原型变体 A=浮动工具栏）：
 * idle 只读渲染（空卡占位「添加笔记...」）→ 单击选中浮出格式工具栏（不可输入）
 * → 双击进编辑 → 失焦 commit（onEditRichText 写回 richDoc + 派生纯文本）。
 * 旧卡兼容：无 richDoc 时以 prompt/content 纯文本播种初始 doc。
 */
export function TextNode({ id, data, width, height, selected }: NodeProps) {
  const d = data as unknown as CanvasNodeData & {
    content?: string;
    prompt?: string;
    richDoc?: unknown;
  };
  const { onEditRichText, mentionItems } = useContext(NodeActionsContext);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpandedState] = useState(false);
  // expanded 的同步镜像：onBlur 在 React 状态提交前也可能触发，须用 ref 判定
  const expandedRef = useRef(false);
  const setExpanded = useCallback((v: boolean) => {
    expandedRef.current = v;
    setExpandedState(v);
  }, []);
  // 初始 doc 只播种一次（编辑器持有内容，commit 后 data.richDoc 回写不再反灌）
  const [initialDoc] = useState<unknown>(
    () => d.richDoc ?? plainTextToDoc(d.prompt ?? d.content ?? ""),
  );
  const commit = useCallback(
    (doc: unknown) => {
      setEditing(false);
      setExpanded(false);
      onEditRichText?.(id, doc, richDocToPlainText(doc));
    },
    [id, onEditRichText, setExpanded],
  );
  // 失焦 commit；展开态失焦不塌缩（模态由 X/Esc/点遮罩关闭并 commit）
  const handleEditorBlur = useCallback(
    (doc: unknown) => {
      if (expandedRef.current) return;
      commit(doc);
    },
    [commit],
  );
  const editor = useRichEditor({
    doc: initialDoc,
    editable: editing || expanded,
    mentionItems: mentionItems ?? [],
    onCommit: handleEditorBlur,
  });
  // 选中态（未进编辑）工具栏命令后立即写回，不改变 editing/expanded 状态
  const syncCommit = useCallback(() => {
    if (!editor) return;
    const doc = editor.getJSON();
    onEditRichText?.(id, doc, richDocToPlainText(doc));
  }, [editor, id, onEditRichText]);
  // 进入编辑/展开后聚焦文末
  useEffect(() => {
    if (editing || expanded) editor?.commands.focus("end");
  }, [editing, expanded, editor]);
  const empty = isEmptyRichDoc(editor ? editor.getJSON() : initialDoc);
  return (
    <>
      <NodeResizer
        nodeId={id}
        isVisible={selected}
        minWidth={160}
        minHeight={48}
        handleClassName="tc-node-resize-handle"
      />
      <NodeToolbar
        isVisible={selected && !expanded}
        position={Position.Top}
        offset={8}
      >
        <TextFormatToolbar
          editor={editor}
          applyToAll={!editing}
          onAnyCommand={syncCommit}
          onExpand={() => {
            setEditing(false);
            setExpanded(true);
          }}
        />
      </NodeToolbar>
      <div
        onDoubleClick={() => setEditing(true)}
        className="tc-text-node relative flex flex-col overflow-hidden rounded-xl"
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
        {/* nodrag 仅编辑态附加：保护文本选区不触发卡片拖拽；只读态整卡可拖（IK5U3K） */}
        <div
          className={`${
            editing || expanded ? "nodrag " : ""
          }nowheel flex-1 overflow-auto px-3 py-2.5`}
        >
          {empty && !editing && !expanded ? (
            <span className="text-sm" style={{ color: "var(--tc-text-muted)" }}>
              添加笔记...
            </span>
          ) : (
            !expanded && <EditorContent editor={editor} />
          )}
        </div>
      </div>
      {expanded && (
        <ExpandModal
          editor={editor}
          onClose={() => {
            if (editor) commit(editor.getJSON());
            else setExpanded(false);
          }}
        />
      )}
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

/**
 * IK55VT 参考卡（单 kind=reference + cardType 五类，三态以产品截图为权威）：
 * ① 全新空卡 = 头部 + 居中栈（从画布拖入 + 静态不可编辑占位 + 添加/生成按钮 + ⓘ1张参考图），无可编辑文字；
 * ② 有参考图 = 头部 + 顶部描述编辑区（双击就地编辑）+ 分隔线 + 大图（宽撑满、高按宽高比自适应、不裁剪）
 *    + 悬停替换（添加图片/生成图片）·删除控件；卡高内容驱动（CanvasSurface 不钉 wrapper 高度）；
 * ③ 删图留史 = 历史描述保留在顶部 + 干净居中栈（无占位文案）。
 * chrome：选中时顶部居中浮出 @ 按钮（点击无行为，预留）；不做「重新编辑」。
 * character 独有底部「音色」区（常显虚线框，悬停展开上传态；选择器数据后续，mock）。
 */
export function ReferenceNode({ id, data, width, selected }: NodeProps) {
  const d = data as unknown as CanvasNodeData;
  const cardType: ReferenceCardType = d.cardType ?? "custom";
  const meta =
    REFERENCE_CARD_TYPES.find((t) => t.id === cardType) ??
    REFERENCE_CARD_TYPES[REFERENCE_CARD_TYPES.length - 1];
  const {
    onEditDescription,
    onEditReferenceName,
    onUploadReferenceImage,
    onGenerateReferenceImage,
    onRemoveReferenceImage,
    referenceDropTargetId,
    onEditProductDetail,
    onRemoveProductImage,
    onImportProductLink,
  } = useContext(NodeActionsContext);
  const refAsset = useCanvasStore((s) =>
    d.referenceAssetId ? s.assets[d.referenceAssetId] : undefined,
  );
  /** IK55VZ 商品卡多图:imageAssetIds → store.assets 解析 src(整 map 选择,引用稳定)。 */
  const assetsMap = useCanvasStore((s) => s.assets);
  /** IK5JV6:描述/卡名内联编辑共用 useInlineEdit(Esc 取消/失焦保存)。 */
  const descEdit = useInlineEdit((text) => onEditDescription?.(id, text));
  const nameEdit = useInlineEdit((text) => onEditReferenceName?.(id, text));
  const [replaceMenuOpen, setReplaceMenuOpen] = useState(false);
  /** IK55VZ 商品卡 chrome 悬停态(selected || hovered 浮出「商品」标签 + 「@ 添加到对话」胶囊)。 */
  const [hovered, setHovered] = useState(false);
  const hasImage = !!d.referenceAssetId;
  const description = d.description ?? "";
  const emptyDesc = description.trim() === "";
  /** 描述区存在条件：有参考图，或删图后留有历史描述（全新空卡无描述区）。 */
  const showDescription = hasImage || !emptyDesc;
  const name = d.name ?? meta.label;
  const isCharacter = cardType === "character";
  const isProduct = cardType === "product";
  const productImages = (d.imageAssetIds ?? []).map((aid) => ({
    id: aid,
    src: assetsMap[aid]?.src,
  }));
  const dropHighlight = referenceDropTargetId === id;
  const cardWidth = width ?? REFERENCE_CARD_WIDTH;
  const aspect = d.referenceImageAspect;
  return (
    <>
      {/* chrome：选中时顶部居中 @ 按钮（IK55VT 预留，点击无引用行为）；商品卡用自己的浮出层(见下) */}
      {!isProduct && (
        <NodeToolbar position={Position.Top} offset={8} isVisible={selected}>
          <button
            type="button"
            aria-label="引用卡片"
            className="nodrag flex items-center justify-center rounded-full"
            style={{
              width: 28,
              height: 28,
              background: "var(--tc-bg-elevated)",
              border: "1px solid var(--tc-border-subtle)",
              color: "var(--tc-text-secondary)",
            }}
            onClick={() => {
              /* 预留：@ 引用行为属后续工单 */
            }}
          >
            <AtSign width={13} height={13} />
          </button>
        </NodeToolbar>
      )}
      {/* IK55VZ 商品卡 chrome(原型定稿):选中或悬停浮出——左上「商品」标签 + 居中「@ 添加到对话」胶囊(预留无行为) */}
      {isProduct && (
        <div
          data-testid="product-chrome"
          className="nodrag absolute -top-10 right-0 left-0 z-10 flex items-center transition-opacity duration-150"
          style={{
            opacity: selected || hovered ? 1 : 0,
            pointerEvents: selected || hovered ? "auto" : "none",
          }}
        >
          <span
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <Package width={12} height={12} />
            商品
          </span>
          <button
            type="button"
            aria-label="@ 添加到对话"
            className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
            style={{
              background: "var(--tc-bg-elevated)",
              border: "1px solid var(--tc-border-subtle)",
              color: "var(--tc-text-secondary)",
              boxShadow: "var(--tc-chrome-float-shadow)",
            }}
            onClick={() => {
              /* 预留：@ 引用行为属后续工单 */
            }}
          >
            <AtSign width={12} height={12} />
            添加到对话
          </button>
        </div>
      )}
      <div
        className="tc-reference-node relative flex flex-col overflow-hidden rounded-xl"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          width: cardWidth,
          // 已填态高度内容驱动（图高随宽高比）；空/留史态用默认卡高；
          // IK55VZ 商品卡:内容驱动 + minHeight 兜底(新建落点 560)。
          // 禁用 RF NodeProps.height:它是 measured 回读(CanvasSurface 剥离 node.height 后
          // 首测前为 0),钉进内联样式会形成 0→测得 2px→钉 2px 的自反馈塌缩环。
          height: isProduct
            ? undefined
            : hasImage
              ? undefined
              : referenceCardHeight(cardType),
          minHeight: isProduct ? referenceCardHeight(cardType) : undefined,
          outline: dropHighlight
            ? "2px solid var(--tc-accent)"
            : selected
              ? "2px solid var(--tc-card-selected-stroke)"
              : "2px solid transparent",
          outlineOffset: 0,
          border: "1px solid var(--tc-border-subtle)",
          background: "var(--tc-bg-surface)",
        }}
      >
        <NodeHandles kind="reference" />
        {/* 头部:@ 圆 chip + 卡名（默认=类型名，双击改名）；商品卡按原型 28px chip + 大号粗体 */}
        <div className="flex items-center gap-2 px-3 pt-3">
          <span
            className="flex shrink-0 items-center justify-center rounded-full"
            style={{
              width: isProduct ? 28 : 20,
              height: isProduct ? 28 : 20,
              background: "var(--tc-bg-elevated)",
              color: "var(--tc-text-tertiary)",
            }}
          >
            <AtSign width={isProduct ? 14 : 11} height={isProduct ? 14 : 11} />
          </span>
          {nameEdit.editing ? (
            <input
              autoFocus
              defaultValue={name}
              className={`nodrag nowheel w-full bg-transparent outline-none ${
                isProduct ? "text-base font-bold" : "text-sm font-semibold"
              }`}
              style={{ color: "var(--tc-text-primary)" }}
              onBlur={nameEdit.handleBlur}
              onKeyDown={(e) => {
                nameEdit.handleKeyDown(e);
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <span
              onDoubleClick={nameEdit.startEditing}
              className={`truncate ${
                isProduct ? "text-base font-bold" : "text-sm font-semibold"
              }`}
              style={{ color: "var(--tc-text-primary)", cursor: "text" }}
            >
              {name}
            </span>
          )}
        </div>

        {isProduct ? (
          /* IK55VZ 商品卡:图片区 + 详情区 + 「从商品链接导入」折叠区(原型纵向三段);
             不渲染单图槽/三按钮空态/替换菜单 */
          <>
            <ProductImageSection
              images={productImages}
              onAdd={() => onUploadReferenceImage?.(id)}
              onRemove={(assetId) => onRemoveProductImage?.(id, assetId)}
            />
            <ProductDetailSection
              detail={d.detail ?? ""}
              placeholder={meta.placeholder}
              onCommit={(text) => onEditProductDetail?.(id, text)}
            />
            <div
              className="mx-3 mt-2"
              style={{ borderTop: "1px solid var(--tc-border-subtle)" }}
            />
            <ProductLinkImportSection
              initialUrl={d.sourceUrl}
              onImport={(url) => onImportProductLink?.(id, url)}
            />
          </>
        ) : (
          <>
            {/* 描述区（有图或留史时存在）：顶部左对齐，双击就地编辑 */}
            {showDescription &&
              (descEdit.editing ? (
                <textarea
                  autoFocus
                  defaultValue={description}
                  placeholder={meta.placeholder}
                  rows={3}
                  onBlur={descEdit.handleBlur}
                  onKeyDown={descEdit.handleKeyDown}
                  className="nodrag nowheel mx-3 mt-2 resize-none bg-transparent text-xs leading-normal outline-none"
                  style={{ color: "var(--tc-text-primary)" }}
                />
              ) : (
                <div
                  onDoubleClick={descEdit.startEditing}
                  className="mx-3 mt-2 text-xs leading-normal"
                  style={{
                    color: emptyDesc
                      ? "var(--tc-text-muted)"
                      : "var(--tc-text-primary)",
                    whiteSpace: "pre-wrap",
                    cursor: "text",
                  }}
                >
                  {emptyDesc ? meta.placeholder : description}
                </div>
              ))}
            {showDescription && (
              <div
                className="mx-3 mt-2"
                style={{ borderTop: "1px solid var(--tc-border-subtle)" }}
              />
            )}

            {hasImage ? (
              /* 已填态：大图（宽撑满、高按宽高比、不裁剪）+ 悬停替换/删除 */
              <div className="px-3 pb-3 pt-2">
                <div
                  className="group relative overflow-hidden rounded-lg"
                  style={{
                    border: "1px solid var(--tc-border-subtle)",
                    background: "var(--tc-bg-elevated)",
                  }}
                >
                  {refAsset?.src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- asset src 为签名 URL，不交 next/image 优化器
                    <img
                      src={refAsset.src}
                      alt={name}
                      className="nodrag block w-full"
                      style={{
                        aspectRatio: aspect ? String(aspect) : undefined,
                        objectFit: aspect ? "cover" : undefined,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: aspect ? String(aspect) : "16/9",
                      }}
                    />
                  )}
                  <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label="替换参考图"
                      className="nodrag flex items-center justify-center rounded-md"
                      style={{
                        width: 24,
                        height: 24,
                        background: "var(--tc-bg-elevated)",
                        border: "1px solid var(--tc-border-subtle)",
                        color: "var(--tc-text-secondary)",
                      }}
                      onClick={() => setReplaceMenuOpen((v) => !v)}
                    >
                      <RefreshCw width={12} height={12} />
                    </button>
                    <button
                      type="button"
                      aria-label="删除参考图"
                      className="nodrag flex items-center justify-center rounded-md"
                      style={{
                        width: 24,
                        height: 24,
                        background: "var(--tc-bg-elevated)",
                        border: "1px solid var(--tc-border-subtle)",
                        color: "var(--tc-text-secondary)",
                      }}
                      onClick={() => onRemoveReferenceImage?.(id)}
                    >
                      <X width={12} height={12} />
                    </button>
                  </div>
                  {replaceMenuOpen && (
                    <div
                      role="menu"
                      className="nodrag absolute right-2 top-9 flex flex-col overflow-hidden rounded-md"
                      style={{
                        background: "var(--tc-bg-elevated)",
                        border: "1px solid var(--tc-border-subtle)",
                      }}
                    >
                      {(
                        [
                          {
                            icon: <Upload width={12} height={12} />,
                            label: "添加图片",
                            run: onUploadReferenceImage,
                          },
                          {
                            icon: <Sparkles width={12} height={12} />,
                            label: "生成图片",
                            run: onGenerateReferenceImage,
                          },
                        ] as const
                      ).map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          role="menuitem"
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs"
                          style={{ color: "var(--tc-text-secondary)" }}
                          onClick={() => {
                            setReplaceMenuOpen(false);
                            item.run?.(id);
                          }}
                        >
                          {item.icon}
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* 空卡/留史态：居中栈（占位文案仅全新空卡显示，静态不可编辑） */
              <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5">
                <span
                  className="text-[13px]"
                  style={{ color: "var(--tc-text-secondary)" }}
                >
                  从画布拖入
                </span>
                {!showDescription && (
                  <span
                    className="text-center text-xs leading-normal"
                    style={{ color: "var(--tc-text-muted)" }}
                  >
                    {meta.placeholder}
                  </span>
                )}
                <div className="flex gap-2">
                  {(
                    [
                      {
                        icon: <Upload width={12} height={12} />,
                        label: "添加图片",
                        run: onUploadReferenceImage,
                      },
                      {
                        icon: <Sparkles width={12} height={12} />,
                        label: "生成图片",
                        run: onGenerateReferenceImage,
                      },
                    ] as const
                  ).map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      className="nodrag flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs"
                      style={{
                        border: "1px solid var(--tc-border-subtle)",
                        background: "var(--tc-bg-elevated)",
                        color: "var(--tc-text-secondary)",
                      }}
                      onClick={() => b.run?.(id)}
                    >
                      {b.icon}
                      {b.label}
                    </button>
                  ))}
                </div>
                <span
                  className="flex items-center gap-1 text-[11px]"
                  style={{ color: "var(--tc-text-muted)" }}
                >
                  <Info width={10} height={10} />1 张参考图
                </span>
              </div>
            )}

            {/* character 独有:音色区（mock：常显虚线框，悬停展开上传态；选择器数据后续） */}
            {isCharacter && (
              <div
                className="px-3 pb-3 pt-2"
                style={{ borderTop: "1px solid var(--tc-border-subtle)" }}
              >
                <div
                  className="mb-1.5 flex items-center gap-1 text-[11px]"
                  style={{ color: "var(--tc-text-tertiary)" }}
                >
                  <Music width={11} height={11} />
                  音色
                </div>
                <div className="group">
                  <div
                    className="flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs group-hover:hidden"
                    style={{
                      border: "1px dashed var(--tc-border-subtle)",
                      background: "var(--tc-bg-elevated)",
                      color: "var(--tc-text-tertiary)",
                    }}
                  >
                    <Music width={12} height={12} />
                    设置角色音色
                  </div>
                  <div
                    className="hidden flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-2 group-hover:flex"
                    style={{
                      border: "1px dashed var(--tc-border-subtle)",
                      background: "var(--tc-bg-elevated)",
                      color: "var(--tc-text-tertiary)",
                    }}
                  >
                    <span className="text-xs">从画布拖入音频</span>
                    <button
                      type="button"
                      className="nodrag flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs"
                      style={{
                        border: "1px solid var(--tc-border-subtle)",
                        color: "var(--tc-text-secondary)",
                      }}
                    >
                      <Upload width={12} height={12} />
                      上传音色音频
                    </button>
                    <span className="text-[10px]">2–15.2 秒 · 建议 ≤ 5 秒</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
