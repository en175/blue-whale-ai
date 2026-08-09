"use client";

// IK74V6：画布媒体节点状态体（从 nodes.tsx 下沉）。
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
import { VideoPlayer, AudioPlayer, isVideoUrl } from "./media-players";

export type MediaStateBodyProps = {
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
