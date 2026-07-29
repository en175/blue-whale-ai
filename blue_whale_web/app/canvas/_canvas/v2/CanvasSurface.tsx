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
} from "@xyflow/react";
import type { CanvasNode, CanvasEdge, MediaKind } from "../model";
import { MediaNode, TextNode, GroupNode, NodeActionsContext } from "./nodes";
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
  /** IK55VH 富文本卡 commit：richDoc + 派生纯文本写回。 */
  onEditRichText?: (id: string, richDoc: unknown, plainText: string) => void;
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
  onEditRichText,
  mentionItems,
  onPaneMenu,
  onEdgeDropMenu,
  picking,
  pickingAccept,
  toolMode = "mouse",
  children,
}: CanvasSurfaceProps) {
  const { zoomIn, zoomOut, fitView, screenToFlowPosition } = useReactFlow();

  // IK55VD：按有效模式展开交互 props；nodesDraggable 再叠加 picking 约束
  const { nodesDraggable: toolNodesDraggable, ...toolInteraction } =
    toolModeInteractionProps(toolMode);

  const [measured, setMeasured] = useState<
    Map<string, { width?: number; height?: number }>
  >(() => new Map());
  const rfNodes = useMemo(
    () =>
      nodes.map((n) => {
        const m = measured.get(n.id);
        return m
          ? {
              ...n,
              measured: m,
              width: m.width ?? n.width,
              height: m.height ?? n.height,
            }
          : n;
      }),
    [nodes, measured],
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
      onEditRichText,
      mentionItems,
      picking,
      pickingAccept,
    }),
    [
      onNodeAction,
      onNodeRetry,
      onEditRichText,
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
