"use client";

// IK74V6：画布节点共享部件（Context/工具栏/句柄，从 nodes.tsx 下沉）。
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
import type { SceneCardView } from "../conversationRecovery";
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

export type MediaNodeData = CanvasNodeData & {
  content?: string;
  errorMessage?: string;
  progress?: number;
  previewUrl?: string;
};

export type NodeActionsCtx = {
  onAction?: (id: string, actionId: string) => void;
  onRetry?: (id: string) => void;
  onRemoveNode?: (id: string) => void;
  onDeleteSceneCard?: (nodeId: string, sceneCardId: string) => Promise<boolean>;
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
  /** 场景卡快照投影（spec §6.2）：SceneCardNode 按 data.sceneCardId 查正文；查不到=不可用态。 */
  sceneCards?: SceneCardView[];
  picking?: boolean;
  pickingAccept?: MediaKind[];
};
export const NodeActionsContext = createContext<NodeActionsCtx>({});

export function NodeToolbarActions({
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
export function useNodeAsset(data: MediaNodeData) {
  const assetId = data.assetId;
  return useCanvasStore((s) => (assetId ? s.assets[assetId] : undefined));
}

/** 工作流连线 UI 总开关：false = 隐藏 Handle（数据结构 edges/ports/engine 保留，恢复改 true）。 */
export const SHOW_WORKFLOW_UI = false;

/** 按 nodeKinds[kind].inputs/outputs 动态渲染 Handle（registry 驱动，非硬编码）。 */
export function NodeHandles({ kind }: { kind: NodeKindId }) {
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
