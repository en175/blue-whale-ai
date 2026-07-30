/**
 * v2 CanvasSurface —— RF 受控层，**props 受控**（nodes/edges/viewport/onNodesChange/
 * onEdgesChange/onConnect 来自 page 的 useCanvasDoc hook）。连线 + 右键/drop 菜单触发。
 * ctrl/cmd +/- 缩放、0 自适应（拦截浏览器）。
 */
"use client";
import {
  useCallback,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type OnConnectEnd,
  type Node as RFNode,
} from "@xyflow/react";
import type { CanvasNode, CanvasEdge, MediaKind } from "../model";
import { pickReferenceDropTarget } from "../placement";
import {
  MediaNode,
  TextNode,
  GroupNode,
  ReferenceNode,
  NodeActionsContext,
} from "./nodes";
import type { TextMentionItem } from "./nodes";
import { SelectionBounds } from "./SelectionBounds";
import { toolModeInteractionProps, type ToolMode } from "./toolMode";

type Viewport = { x: number; y: number; zoom: number };
const nodeTypes = {
  image: MediaNode,
  video: MediaNode,
  audio: MediaNode,
  text: TextNode,
  group: GroupNode,
  reference: ReferenceNode,
} as const;

/** 右键/drop 菜单位置（x/y=画布世界坐标供建节点，screenX/Y=屏幕坐标供浮层定位）。 */
export type MenuPayload = {
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  source?: string;
  sourceHandle?: string;
};

export type CanvasSurfaceProps = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  onNodesChange(changes: NodeChange[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(connection: Connection): void;
  onViewportChange: (vp: Viewport) => void;
  onNodeClick?: (node: CanvasNode) => void;
  onPaneClick?: () => void;
  onNodeAction?: (id: string, actionId: string) => void;
  onNodeRetry?: (id: string) => void;
  onNodeRemove?: (id: string) => void;
  /** IK55VL 视频卡生成中取消入口（按节点 taskId 取消任务）。 */
  onNodeCancelJob?: (id: string) => void;
  /** IK55VH 富文本卡 commit：richDoc + 派生纯文本写回。 */
  onEditRichText?: (id: string, richDoc: unknown, plainText: string) => void;
  /** IK55VS 参考卡描述 commit 写回。 */
  onEditDescription?: (id: string, text: string) => void;
  /** IK55VT 参考卡卡名 commit 写回。 */
  onEditReferenceName?: (id: string, name: string) => void;
  /** IK55VT 参考图通道二：本地上传（runtime 开 file picker）。 */
  onUploadReferenceImage?: (id: string) => void;
  /** IK55VT 参考图通道三：打开图像生成 Dock（结果回落该卡槽）。 */
  onGenerateReferenceImage?: (id: string) => void;
  /** IK55VT 删除参考图：回空态（历史描述保留）。 */
  onRemoveReferenceImage?: (id: string) => void;
  /** IK55VT 通道一：图片素材节点拖放落到参考卡（refNodeId, sourceNodeId）。 */
  onReferenceImageDrop?: (refNodeId: string, sourceNodeId: string) => void;
  /** IK55VZ 商品卡详情 commit 写回。 */
  onEditProductDetail?: (id: string, text: string) => void;
  /** IK55VZ 商品卡移除单张图。 */
  onRemoveProductImage?: (id: string, assetId: string) => void;
  /** IK55VZ 商品卡链接导入（runtime mock 解析填充）。 */
  onImportProductLink?: (id: string, url: string) => void;
  /** IK55VH 富文本卡 @ 建议素材列表。 */
  mentionItems?: TextMentionItem[];
  onPaneMenu?: (payload: MenuPayload) => void;
  onEdgeDropMenu?: (payload: MenuPayload) => void;
  picking?: boolean;
  /** D-3 picking 按 Dock 类型过滤（dockAccept）；undefined = 不过滤（任何媒体可选） */
  pickingAccept?: MediaKind[];
  /** IK55VD 有效工具模式（页面层已合成 持久模式 OR 空格），默认鼠标。 */
  toolMode?: ToolMode;
  children?: ReactNode;
};

export function CanvasSurface({
  nodes,
  edges,
  viewport,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onViewportChange,
  onNodeClick,
  onPaneClick,
  onNodeAction,
  onNodeRetry,
  onNodeRemove,
  onNodeCancelJob,
  onEditRichText,
  onEditDescription,
  onEditReferenceName,
  onUploadReferenceImage,
  onGenerateReferenceImage,
  onRemoveReferenceImage,
  onReferenceImageDrop,
  onEditProductDetail,
  onRemoveProductImage,
  onImportProductLink,
  mentionItems,
  onPaneMenu,
  onEdgeDropMenu,
  picking,
  pickingAccept,
  toolMode = "mouse",
  children,
}: CanvasSurfaceProps) {
  const {
    zoomIn,
    zoomOut,
    fitView,
    screenToFlowPosition,
    getIntersectingNodes,
  } = useReactFlow();

  // IK55VD：按有效模式展开交互 props；nodesDraggable 再叠加 picking 约束
  const { nodesDraggable: toolNodesDraggable, ...toolInteraction } =
    toolModeInteractionProps(toolMode);

  const [measured, setMeasured] = useState<
    Map<string, { width?: number; height?: number }>
  >(() => new Map());
  // IK55VT 通道一：拖拽素材命中参考卡的高亮目标（经 context 下发，ReferenceNode 高亮）
  const [referenceDropTargetId, setReferenceDropTargetId] = useState<
    string | null
  >(null);
  const rfNodes = useMemo(
    () =>
      nodes.map((n) => {
        const m = measured.get(n.id);
        const withMeasured = m
          ? {
              ...n,
              measured: m,
              width: m.width ?? n.width,
              height: m.height ?? n.height,
            }
          : n;
        // IK55VT：参考卡高度内容驱动（已填态图高随宽高比自适应），不钉死 wrapper 高度，
        // 让 RF ResizeObserver 测量接管；空/留史态由组件内 style 定高
        return n.data.kind === "reference"
          ? { ...withMeasured, height: undefined }
          : withMeasured;
      }),
    [nodes, measured],
  );

  /** IK55VT 通道一：拖动中实时算参考卡命中（图片素材才高亮）。 */
  const handleNodeDrag = useCallback(
    (_e: MouseEvent | TouchEvent, node: RFNode) => {
      const d = node.data as CanvasNode["data"];
      const target = pickReferenceDropTarget(
        { kind: d.kind, assetId: d.assetId },
        getIntersectingNodes(node).map((n) => {
          const nd = n.data as CanvasNode["data"];
          return {
            id: n.id,
            kind: nd.kind,
            // IK55VZ:product 满 8 图跳过(追加语义上限)
            cardType: nd.cardType,
            imageCount: nd.imageAssetIds?.length,
          };
        }),
      );
      if (target !== referenceDropTargetId) setReferenceDropTargetId(target);
    },
    [getIntersectingNodes, referenceDropTargetId],
  );

  /** IK55VT 通道一：拖放结束命中参考卡 → 回调 runtime 落槽。 */
  const handleNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: RFNode) => {
      const target = referenceDropTargetId;
      setReferenceDropTargetId(null);
      const d = node.data as CanvasNode["data"];
      if (target && d.kind === "image" && d.assetId)
        onReferenceImageDrop?.(target, node.id);
    },
    [referenceDropTargetId, onReferenceImageDrop],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (changes.some((c) => c.type === "dimensions")) {
        const m = new Map(measured);
        for (const c of changes) {
          if (c.type === "dimensions" && c.dimensions)
            m.set(c.id, {
              width: c.dimensions.width,
              height: c.dimensions.height,
            });
        }
        setMeasured(m);
      }
      onNodesChange(changes);
    },
    [measured, onNodesChange],
  );

  // 拖 edge drop 到空白（toNode null）→ 弹 drop 菜单（插节点 + 连边）
  const handleConnectEnd = useCallback<OnConnectEnd>(
    (event, cs) => {
      if (cs.toNode || cs.isValid) return; // 正常连上，交 onConnect
      const pt =
        "changedTouches" in event && event.changedTouches.length
          ? event.changedTouches[0]
          : (event as MouseEvent);
      if (!("clientX" in pt)) return;
      const pos = screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      onEdgeDropMenu?.({
        x: pos.x,
        y: pos.y,
        screenX: pt.clientX,
        screenY: pt.clientY,
        source: cs.fromNode?.id,
        sourceHandle: cs.fromHandle?.id ?? undefined,
      });
    },
    [screenToFlowPosition, onEdgeDropMenu],
  );

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onPaneMenu?.({
        x: pos.x,
        y: pos.y,
        screenX: event.clientX,
        screenY: event.clientY,
      });
    },
    [screenToFlowPosition, onPaneMenu],
  );

  // ctrl/cmd +/- 缩放、0 自适应；拦截浏览器缩放
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        fitView();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut, fitView]);

  const nodeActionsValue = useMemo(
    () => ({
      onAction: onNodeAction,
      onRetry: onNodeRetry,
      onRemoveNode: onNodeRemove,
      onCancelJob: onNodeCancelJob,
      onEditRichText,
      onEditDescription,
      onEditReferenceName,
      onUploadReferenceImage,
      onGenerateReferenceImage,
      onRemoveReferenceImage,
      onEditProductDetail,
      onRemoveProductImage,
      onImportProductLink,
      referenceDropTargetId,
      mentionItems,
      picking,
      pickingAccept,
    }),
    [
      onNodeAction,
      onNodeRetry,
      onNodeRemove,
      onNodeCancelJob,
      onEditRichText,
      onEditDescription,
      onEditReferenceName,
      onUploadReferenceImage,
      onGenerateReferenceImage,
      onRemoveReferenceImage,
      onEditProductDetail,
      onRemoveProductImage,
      onImportProductLink,
      referenceDropTargetId,
      mentionItems,
      picking,
      pickingAccept,
    ],
  );

  return (
    <div
      className={`tc-canvas-surface absolute inset-0 z-0 select-none ${toolMode === "hand" ? "tool-mode-hand" : "tool-mode-mouse"}`}
    >
      <NodeActionsContext.Provider value={nodeActionsValue}>
        <ReactFlow
          nodes={rfNodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={handleConnectEnd}
          viewport={viewport}
          onViewportChange={onViewportChange}
          onPaneContextMenu={handlePaneContextMenu}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{
            style: { stroke: "#ffffff", strokeWidth: 2.5 },
          }}
          nodesConnectable={false}
          {...toolInteraction}
          nodesDraggable={toolNodesDraggable && !picking}
          minZoom={0.1}
          maxZoom={3}
          deleteKeyCode={["Backspace", "Delete"]}
          panActivationKeyCode="Space"
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomActivationKeyCode="Control"
          multiSelectionKeyCode={["Meta", "Control", "Shift"]}
          selectionMode={SelectionMode.Partial}
          elevateNodesOnSelect
          colorMode="dark"
          onNodeClick={(_e, node) =>
            onNodeClick?.(node as unknown as CanvasNode)
          }
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={() => onPaneClick?.()}
          proOptions={{ hideAttribution: true }}
        >
          <SelectionBounds />
          {children}
        </ReactFlow>
      </NodeActionsContext.Provider>
    </div>
  );
}
