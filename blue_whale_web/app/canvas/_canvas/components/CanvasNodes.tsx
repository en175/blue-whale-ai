/**
 * CanvasNodes —— 画布核心区节点体系（展示层，React Flow 驱动）
 *
 * 迁移自自研 div 拖拽 + CSS transform。现由 `@xyflow/react` 承载视口平移/缩放、
 * 节点拖拽/选中/框选；本文件只提供：
 * - `CanvasNodeData` / `CanvasNode`：RF 节点类型（render 字段走 `data`）。
 * - `toRFNode` / `fromRFNode`：NodeItem ↔ RF Node 双向映射（受控流 round-trip）。
 * - `MediaStateBody`：节点媒体体（loading/error/ready 渲染态，image/video 共用，无 RF 依赖可单测）。
 * - `ImageNode` / `VideoNode` / `TextNode`：自定义节点组件（NodeResizer 补 resize、NodeToolbar 承载操作浮层）。
 * - `CanvasSurface`：受控 `<ReactFlow>`，承接 nodes/viewport + 各类 commit/事件回调。
 *
 * 坐标语义对齐 RF：world 坐标由 `position{x,y}` 承载（替代原 x/y），见 types.ts。
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Image as ImageIcon,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Video as VideoIcon,
} from "lucide-react";
import {
  ReactFlow,
  NodeResizer,
  NodeToolbar,
  Position,
  applyNodeChanges,
} from "@xyflow/react";
import type {
  Node,
  NodeProps,
  OnNodesChange,
  OnMoveEnd,
} from "@xyflow/react";
import { NODE_TOOLBAR_ACTIONS, NODE_TOOLBAR_VIDEO_ACTIONS, type NodeToolbarAction } from "../config";
import type { NodeItem, NodeStatus, NodeType, Viewport } from "../types";

/** RF 节点 data：承载渲染与持久化字段（不随 RF 内部 change 丢失）。 */
export type CanvasNodeData = {
  width: number;
  height: number;
  content?: string;
  imageUrl?: string;
  assetId?: number;
  status?: NodeStatus;
  errorMessage?: string;
  /** 视频生成进度（0-100，loading 期展示；临时态）。 */
  progress?: number;
  /** 旋转角度（度）；RF 不接管，随 data round-trip 保留。 */
  rotation?: number;
  /** 图层排序；RF `elevateNodesOnSelect` 处理视觉抬升，此值用于持久化基线。 */
  zIndex?: number;
};

/** 受控流使用的 RF 节点类型。 */
export type CanvasNode = Node<CanvasNodeData, NodeType>;

/** NodeItem（聚合根态）→ RF Node（受控渲染态）。 */
export function toRFNode(n: NodeItem): CanvasNode {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    width: n.width,
    height: n.height,
    selected: n.selected ?? false,
    data: {
      width: n.width,
      height: n.height,
      content: n.content,
      imageUrl: n.imageUrl,
      assetId: n.assetId,
      status: n.status,
      errorMessage: n.errorMessage,
      progress: n.progress,
      rotation: n.rotation,
      zIndex: n.zIndex,
    },
  };
}

/** RF Node → NodeItem（change round-trip 后写回聚合根）。 */
export function fromRFNode(rf: CanvasNode): NodeItem {
  const width = rf.width ?? rf.data.width;
  const height = rf.height ?? rf.data.height;
  return {
    id: rf.id,
    type: (rf.type as NodeType) ?? "image",
    position: rf.position,
    width,
    height,
    selected: rf.selected,
    content: rf.data.content,
    imageUrl: rf.data.imageUrl,
    assetId: rf.data.assetId,
    status: rf.data.status,
    errorMessage: rf.data.errorMessage,
    progress: rf.data.progress,
    rotation: rf.data.rotation,
    zIndex: rf.data.zIndex,
  };
}

/**
 * 节点级上下文：自定义节点（经 nodeTypes 注册）无法直接收 props，
 * 借 Context 注入操作浮层动作、resize-end（保存触发点）与「从画布选择」模式。
 */
type NodeActionsContextValue = {
  onAction?: (nodeId: string, actionId: string) => void;
  onResizeEnd?: (nodeId: string) => void;
  /** 占位/失败节点重试：读节点 content(prompt) 重新触发生成。 */
  onRetry?: (nodeId: string) => void;
  /** 是否处于「从画布选择」模式：合格图片节点显示呼吸描边 + 角标。 */
  picking?: boolean;
};
const NodeActionsContext = createContext<NodeActionsContextValue>({});

/** 视频 url 判断（按后缀，兼容 query string）。 */
function isVideoUrl(url?: string): boolean {
  return !!url && /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i.test(url);
}

/** 秒 → m:ss（超 1 小时显示 h:mm:ss）。 */
function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? `${h}:${mm}` : `${m}`) + `:${String(r).padStart(2, "0")}`;
}

/**
 * 视频节点自定义播放器。画面不加 nodrag → 在画面上拖动即拖节点；底部控制条加
 * nodrag/nopan 隔离 RF 拖动，保证播放/暂停/seek 可交互；单击画面切换播放
 * （单击不触发节点拖动，RF 有拖动阈值）。原生 controls 是 shadow DOM 无法局部
 * 加 nodrag，故自定义控制条是「节点可拖 + 控制条可用」唯一兼容解。
 */
function VideoPlayer({ src, label }: { src: string; label?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
    } else {
      v.pause();
    }
  }, []);

  const seekTo = useCallback(
    (clientX: number) => {
      const v = videoRef.current;
      const bar = barRef.current;
      if (!v || !bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      v.currentTime = ratio * duration;
    },
    [duration],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      seekTo(e.clientX);
    },
    [seekTo],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      seekTo(e.clientX);
    },
    [seekTo],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const ratio = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        src={src}
        aria-label={label || "视频"}
        className="h-full w-full rounded-lg object-contain"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
      />
      {/* 控制条：nodrag/nopan 隔离画布拖拽，保证播放/seek 可交互；半透明底不遮主体 */}
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
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
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

/**
 * 节点媒体体：按 status 渲染 loading/error/ready（design D3/D14/D15/D16）。
 * image/video 共用：ready 时 image 显 `<img>`、video 显 VideoPlayer；loading 显
 * spinner（video 附 progress 百分比）；error 显 errorMessage + 重试按钮（→ onRetry）。
 * 纯展示、无 RF 依赖，独立单测（MediaStateBody 不经 ReactFlow 即可 render）。
 */
export type MediaStateBodyProps = {
  type: NodeType;
  status?: NodeStatus;
  imageUrl?: string;
  content?: string;
  errorMessage?: string;
  progress?: number;
  onRetry?: () => void;
};

export function MediaStateBody({
  type,
  status,
  imageUrl,
  content,
  errorMessage,
  progress,
  onRetry,
}: MediaStateBodyProps) {
  // error：留节点 + 文案 + 重试（D3，不删节点丢上下文）
  if (status === "error") {
    return (
      <div
        data-testid="node-error"
        className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        <AlertCircle width={28} height={28} stroke="var(--tc-destructive)" strokeWidth={1.5} />
        <span className="text-xs leading-4" style={{ color: "var(--tc-text-tertiary)" }}>
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
  // loading：spinner + 文案（video 附 progress，D16）
  if (status === "loading") {
    const showProgress = type === "video" && typeof progress === "number" && progress >= 0;
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
        <span className="text-xs leading-4" style={{ color: "var(--tc-text-tertiary)" }}>
          {showProgress ? `生成中 ${Math.round(progress as number)}%` : "生成中…"}
        </span>
      </div>
    );
  }
  // ready（含 status 省略，兼容旧数据：旧节点无 status 字段视为 ready）
  if (imageUrl) {
    return type === "video" || isVideoUrl(imageUrl) ? (
      <VideoPlayer src={imageUrl} label={content} />
    ) : (
      <img
        src={imageUrl}
        alt={content || "图片"}
        className="h-full w-full rounded-lg object-contain"
        draggable={false}
      />
    );
  }
  // ready 但无 url（空占位，正常流程不应出现）
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

/** 图片节点：NodeResizer 补 resize、NodeToolbar 承载操作菜单、可选态呼吸角标。 */
function ImageNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { onAction, onRetry, picking } = useContext(NodeActionsContext);
  const width = data.width;
  const height = data.height;
  // loading/error 不参与「从画布选择」（无成品可挑）
  const pickable =
    picking && !!data.imageUrl && data.status !== "loading" && data.status !== "error";
  return (
    <>
      <NodeToolbar position={Position.Top} offset={8}>
        <NodeToolbarActions
          actions={isVideoUrl(data.imageUrl) ? NODE_TOOLBAR_VIDEO_ACTIONS : undefined}
          onAction={(actionId) => onAction?.(id, actionId)}
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
        aria-label={data.content || "图片"}
      >
        <NodeResizer
          nodeId={id}
          isVisible={selected}
          minWidth={40}
          minHeight={40}
          keepAspectRatio={true}
          handleClassName="tc-node-resize-handle"
        />
        {pickable && (
          <span className="tc-canvas-pickable-badge" aria-hidden="true">
            <Plus width={13} height={13} strokeWidth={2.5} />
          </span>
        )}
        <div
          className={`nodrag absolute -top-6 left-0 flex items-center text-xs font-normal leading-4 select-none transition-opacity duration-150 ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          style={{ width }}
        >
          <div
            className="flex min-w-0 flex-1 items-center gap-[5px]"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <ImageIcon width={13} height={13} stroke="currentColor" />
            <span className="tc-node-label-bar__name relative inline-block max-w-[216px] cursor-text overflow-hidden text-ellipsis whitespace-nowrap align-bottom">
              {data.content || "图片节点"}
            </span>
          </div>
        </div>
        <MediaStateBody
          type="image"
          status={data.status}
          imageUrl={data.imageUrl}
          content={data.content}
          errorMessage={data.errorMessage}
          onRetry={() => onRetry?.(id)}
        />
      </div>
    </>
  );
}

/** 视频节点：NodeToolbar 视频菜单 + MediaStateBody(type=video)。ready 显 VideoPlayer / loading 显 progress / error 重试。 */
function VideoNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { onAction, onRetry } = useContext(NodeActionsContext);
  const width = data.width;
  const height = data.height;
  return (
    <>
      <NodeToolbar position={Position.Top} offset={8}>
        <NodeToolbarActions
          actions={NODE_TOOLBAR_VIDEO_ACTIONS}
          onAction={(actionId) => onAction?.(id, actionId)}
        />
      </NodeToolbar>
      <div
        className="tc-image-node__media group relative overflow-visible rounded-lg"
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
        role="video"
        aria-label={data.content || "视频"}
      >
        <NodeResizer
          nodeId={id}
          isVisible={selected}
          minWidth={40}
          minHeight={40}
          keepAspectRatio={true}
          handleClassName="tc-node-resize-handle"
        />
        <div
          className={`nodrag absolute -top-6 left-0 flex items-center text-xs font-normal leading-4 select-none transition-opacity duration-150 ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          style={{ width }}
        >
          <div
            className="flex min-w-0 flex-1 items-center gap-[5px]"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <VideoIcon width={13} height={13} stroke="currentColor" />
            <span className="tc-node-label-bar__name relative inline-block max-w-[216px] cursor-text overflow-hidden text-ellipsis whitespace-nowrap align-bottom">
              {data.content || "视频节点"}
            </span>
          </div>
        </div>
        <MediaStateBody
          type="video"
          status={data.status}
          imageUrl={data.imageUrl}
          content={data.content}
          errorMessage={data.errorMessage}
          progress={data.progress}
          onRetry={() => onRetry?.(id)}
        />
      </div>
    </>
  );
}

/** 文本节点：可拖拽/选中，暂不 resize。 */
function TextNode({ data, selected }: NodeProps<CanvasNode>) {
  return (
    <div
      className="tc-text-node flex items-center justify-center rounded-xl px-4"
      style={{
        width: data.width,
        height: data.height,
        outline: selected ? "2px solid var(--tc-card-selected-stroke)" : "2px solid transparent",
        outlineOffset: 0,
        background: "var(--tc-bg-surface)",
      }}
    >
      <span className="text-center text-sm leading-5" style={{ color: "var(--tc-text-secondary)" }}>
        {data.content}
      </span>
    </div>
  );
}

/** 操作浮层内容：复用 NODE_TOOLBAR_ACTIONS 配置，渲染「图标+文字」卡片，均匀横排。 */
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
        if (action.id === "divider") {
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
        }
        if (action.iconOnly) {
          return (
            <button
              key={action.id}
              type="button"
              aria-label={action.label}
              onClick={() => onAction(action.id)}
              className="tc-node-toolbar-button tc-ui-glow-btn flex items-center justify-center rounded-lg hover:bg-[var(--tc-menu-item-hover)] hover:text-white"
              style={{ width: 32, height: 32, padding: 0, border: 0, background: "transparent", color: "var(--tc-text-secondary)" }}
            >
              {action.icon}
            </button>
          );
        }
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
              style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.02em", lineHeight: "16px" }}
            >
              {action.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** nodeTypes 须稳定引用（RF 内部按引用判等重建），模块级常量。 */
const nodeTypes = { image: ImageNode, text: TextNode, video: VideoNode } as const;

export type CanvasSurfaceProps = {
  nodes: NodeItem[];
  viewport: Viewport;
  /** 受控流 change（拖拽/选中/resize/删除）写回聚合根。 */
  onNodesCommit: (nodes: NodeItem[]) => void;
  /** 受控视口变更写回（pan/zoom 实时）。 */
  onViewportChange: (viewport: Viewport) => void;
  /** 节点拖拽结束（保存触发点）。 */
  onNodeDragStop?: (node: NodeItem) => void;
  /** resize 结束（保存触发点）。 */
  onNodeResizeEnd?: (nodeId: string) => void;
  /** 视口移动结束（保存触发点）。 */
  onMoveEnd?: OnMoveEnd;
  /** 选中集合变化。 */
  onSelectionChange?: (nodeIds: string[]) => void;
  /** 节点点击（「从画布选择」模式在此拦截）。 */
  onNodeClick?: (node: NodeItem) => void;
  /** 画布空白点击（退出选择模式）。 */
  onPaneClick?: () => void;
  /** 操作浮层动作分发。 */
  onNodeAction?: (nodeId: string, actionId: string) => void;
  /** 占位/失败节点重试（唤起 Dock 重配，design D13）。 */
  onNodeRetry?: (nodeId: string) => void;
  /** 是否处于「从画布选择」模式。 */
  picking?: boolean;
};

export function CanvasSurface({
  nodes,
  viewport,
  onNodesCommit,
  onViewportChange,
  onNodeDragStop,
  onNodeResizeEnd,
  onMoveEnd,
  onSelectionChange,
  onNodeClick,
  onPaneClick,
  onNodeAction,
  onNodeRetry,
  picking,
}: CanvasSurfaceProps) {
  // RF 受控流坑（error #015）：每次 onNodesChange→commit→reducer→props.nodes 新引用，
  // rfNodes memo 重算若不带 measured，RF 把受控节点当"新"反复 re-init，拖拽命中未初始化节点刷屏。
  // 解：用 state 缓存 RF 测得的 measured/尺寸（render 期读 state 合法，事件处理器里 setState 合法，
  // 避开 ref-during-render），注入受控节点跨 render 保持 initialized。
  const [measured, setMeasured] = useState<Map<string, { width?: number; height?: number }>>(
    () => new Map()
  );
  const rfNodes = useMemo(
    () =>
      nodes.map((n) => {
        const m = measured.get(n.id);
        return {
          ...toRFNode(n),
          measured: m,
          width: m?.width ?? n.width,
          height: m?.height ?? n.height,
        } satisfies CanvasNode;
      }),
    [nodes, measured]
  );

  const handleNodesChange = useCallback<OnNodesChange<CanvasNode>>(
    (changes) => {
      const next = applyNodeChanges<CanvasNode>(changes, rfNodes);
      setMeasured((prev) => {
        const m = new Map(prev);
        for (const nd of next) {
          m.set(nd.id, { width: nd.width, height: nd.height });
        }
        return m;
      });
      onNodesCommit(next.map(fromRFNode));
    },
    [rfNodes, onNodesCommit]
  );

  const nodeActionsValue = useMemo<NodeActionsContextValue>(
    () => ({ onAction: onNodeAction, onRetry: onNodeRetry, picking }),
    [onNodeAction, onNodeRetry, picking]
  );

  return (
    <div className="tc-canvas-surface absolute inset-0 z-0 select-none">
      <NodeActionsContext.Provider value={nodeActionsValue}>
        <ReactFlow
          nodes={rfNodes}
          onNodesChange={handleNodesChange}
          viewport={viewport}
          onViewportChange={onViewportChange}
          onMoveEnd={onMoveEnd}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={!picking}
          elementsSelectable
          minZoom={0.1}
          maxZoom={3}
          deleteKeyCode={["Backspace", "Delete"]}
          // 框选（task 3.6）：左键拖空白直接框选（Figma 式，无需 Shift）
          selectionOnDrag
          // 平移：中键/右键拖 / 空格+左键拖；滚轮 & 触摸板双指平移（panOnScroll，对齐 topview）
          panOnDrag={[1, 2]}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          // 缩放：Cmd/Ctrl+滚轮（zoomActivationKeyCode）；触摸板捏合缩放
          zoomActivationKeyCode="Control"
          // 多选：Ctrl/Shift/Cmd 点选追加
          multiSelectionKeyCode={["Meta", "Control", "Shift"]}
          // 图层 z 序（task 3.6）：选中即抬升 z-index（bringToFront），默认 true 此处显式固化
          elevateNodesOnSelect
          colorMode="dark"
          onNodeClick={(_e, node) => onNodeClick?.(fromRFNode(node as CanvasNode))}
          onPaneClick={() => onPaneClick?.()}
          onNodeDragStop={(_e, node) => onNodeDragStop?.(fromRFNode(node as CanvasNode))}
          onSelectionChange={({ nodes: selected }) =>
            onSelectionChange?.(selected.map((n) => n.id))
          }
          proOptions={{ hideAttribution: true }}
        />
      </NodeActionsContext.Provider>
    </div>
  );
}
