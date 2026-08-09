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


import {
  NodeActionsContext,
  NodeToolbarActions,
  useNodeAsset,
  SHOW_WORKFLOW_UI,
  NodeHandles,
  type MediaNodeData,
} from "./node-shared";
import { MediaStateBody } from "./media-state-body";
import { isVideoUrl } from "./media-players";

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

// IK74V6：以下部件已下沉到独立文件，此处 re-export 保持既有 import 路径兼容。
export { isVideoUrl, formatTime, VideoPlayer, AudioPlayer } from "./media-players";
export { MediaStateBody, type MediaStateBodyProps } from "./media-state-body";
export {
  NodeActionsContext,
  NodeToolbarActions,
  useNodeAsset,
  SHOW_WORKFLOW_UI,
  NodeHandles,
  type NodeActionsCtx,
  type MediaNodeData,
} from "./node-shared";
export { ReferenceNode } from "./reference-node";
