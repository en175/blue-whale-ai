/**
 * CanvasNodes —— 画布核心区节点体系（展示层）
 * CanvasBackground：网格背景；ImageNode/TextNode：素材/文本节点；
 * NodeToolbar：节点操作浮层；CanvasSurface：统一承载视口变换、节点渲染与交互（拖拽/缩放/选中）。
 */
import { useCallback, useMemo, useRef } from "react";
import { Image as ImageIcon } from "lucide-react";
import { NODE_TOOLBAR_ACTIONS } from "../config";
import type { NodeItem, Viewport } from "../types";

export function CanvasBackground() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      style={{ opacity: 0.35 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="canvas-dot-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="0.5" cy="0.5" r="0.5" fill="rgba(255,255,255,0.2)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#canvas-dot-pattern)" />
    </svg>
  );
}

export function ImageNode({
  node,
  selected,
  onPointerDown,
}: {
  node: NodeItem;
  selected?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, node: NodeItem) => void;
}) {
  return (
    <div
      className={[
        "tc-canvas-card-node tc-image-node__media absolute overflow-visible rounded-lg",
        selected ? "z-[110]" : "z-[100]",
      ].join(" ")}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        outline: selected
          ? "2px solid var(--tc-card-selected-stroke, rgba(235, 235, 235, 0.88))"
          : "2px solid transparent",
        outlineOffset: 0,
        backgroundImage:
          "linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 50%, #2a2a2a 100%)",
      }}
      role="img"
      aria-label="图片"
      onPointerDown={(e) => onPointerDown?.(e, node)}
    >
      <div className="absolute -top-6 left-0 flex items-center text-xs font-normal leading-4 select-none" style={{ width: node.width }}>
        <div className="flex min-w-0 flex-1 items-center gap-[5px] text-white/70">
          <ImageIcon width={13} height={13} stroke="currentColor" />
          <span className="tc-node-label-bar__name relative inline-block max-w-[216px] cursor-text overflow-hidden text-ellipsis whitespace-nowrap align-bottom">
            {node.content || "图片节点"}
          </span>
        </div>
      </div>
      {node.imageUrl ? (
        <img
          src={node.imageUrl}
          alt={node.content || "图片"}
          className="h-full w-full object-contain rounded-lg"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/25">
          <ImageIcon width={48} height={48} stroke="currentColor" strokeWidth={1} />
        </div>
      )}
      {selected && (
        <div className="tc-node-resize-handles">
          <div
            className="tc-node-resize-handle absolute top-0 left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80"
            data-corner="top-left"
            role="button"
            aria-label="调整图片大小"
          />
          <div
            className="tc-node-resize-handle absolute top-0 right-0 h-2.5 w-2.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80"
            data-corner="top-right"
            role="button"
            aria-label="调整图片大小"
          />
          <div
            className="tc-node-resize-handle absolute bottom-0 left-0 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-white/80"
            data-corner="bottom-left"
            role="button"
            aria-label="调整图片大小"
          />
          <div
            className="tc-node-resize-handle absolute bottom-0 right-0 h-2.5 w-2.5 translate-x-1/2 translate-y-1/2 rounded-full bg-white/80"
            data-corner="bottom-right"
            role="button"
            aria-label="调整图片大小"
          />
        </div>
      )}
    </div>
  );
}

export function TextNode({
  node,
  selected,
  onPointerDown,
}: {
  node: NodeItem;
  selected?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, node: NodeItem) => void;
}) {
  return (
    <div
      className={[
        "tc-canvas-card-node tc-text-node absolute rounded-xl flex items-center justify-center px-4",
        selected ? "z-[110]" : "z-[100]",
      ].join(" ")}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        outline: selected
          ? "2px solid var(--tc-card-selected-stroke, rgba(235, 235, 235, 0.88))"
          : "2px solid transparent",
        outlineOffset: 0,
        background: "rgba(255,255,255,0.06)",
      }}
      onPointerDown={(e) => onPointerDown?.(e, node)}
    >
      <span className="text-sm text-white/90 text-center leading-5">{node.content}</span>
    </div>
  );
}
export function NodeToolbar({ node, onAction }: { node: NodeItem; onAction?: (id: string) => void }) {
  return (
    <div
      className="tc-node-toolbar absolute z-[120] -translate-x-1/2 -translate-y-full rounded-[14px] bg-[#1a1a1a]/95 px-2 py-1.5 flex items-center gap-1 border border-white/[0.08] backdrop-blur-md"
      style={{ left: node.x + node.width / 2, top: node.y - 8 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {NODE_TOOLBAR_ACTIONS.map((action) => {
        if (action.id.startsWith("divider")) {
          return (
            <div
              key={action.id}
              style={{
                width: 1,
                height: 24,
                background: "rgba(255, 255, 255, 0.1)",
                margin: "0px 2px",
                flexShrink: 0,
              }}
            />
          );
        }
        if (action.hidden) return null;
        return (
          <div key={action.id} className="tc-node-toolbar-action" style={{ position: "relative" }}>
            <button
              type="button"
              aria-label={action.label}
              aria-pressed="false"
              aria-expanded="false"
              onClick={() => onAction?.(action.id)}
              className="tc-node-toolbar-button flex items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
              style={{ width: 32, height: 32, padding: 8, border: 0, background: "transparent", cursor: "pointer" }}
            >
              {action.icon}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function CanvasSurface({
  containerRef,
  viewport,
  nodes,
  selectedId,
  setViewport,
  setNodes,
  setSelectedId,
  onNodeAction,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  nodes: NodeItem[];
  selectedId: string | null;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  setNodes: React.Dispatch<React.SetStateAction<NodeItem[]>>;
  setSelectedId: (id: string | null) => void;
  onNodeAction?: (node: NodeItem, actionId: string) => void;
}) {
  const dragRef = useRef<{
    mode: "pan" | "node" | null;
    startX: number;
    startY: number;
    startViewportX: number;
    startViewportY: number;
    startNodeX: number;
    startNodeY: number;
    nodeId: string;
    startScale: number;
  }>({
    mode: null,
    startX: 0,
    startY: 0,
    startViewportX: 0,
    startViewportY: 0,
    startNodeX: 0,
    startNodeY: 0,
    nodeId: "",
    startScale: 1,
  });

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - viewport.x) / viewport.scale,
      y: (sy - viewport.y) / viewport.scale,
    }),
    [viewport]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const world = screenToWorld(mx, my);
      const scaleFactor = Math.exp(-e.deltaY * 0.001);
      const newScale = Math.min(3, Math.max(0.1, viewport.scale * scaleFactor));
      setViewport({
        x: mx - world.x * newScale,
        y: my - world.y * newScale,
        scale: newScale,
      });
    },
    [containerRef, viewport, screenToWorld, setViewport]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setSelectedId(null);
    dragRef.current = {
      mode: "pan",
      startX: e.clientX,
      startY: e.clientY,
      startViewportX: viewport.x,
      startViewportY: viewport.y,
      startNodeX: 0,
      startNodeY: 0,
      nodeId: "",
      startScale: viewport.scale,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleNodePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    node: NodeItem
  ) => {
    e.stopPropagation();
    setSelectedId(node.id);
    dragRef.current = {
      mode: "node",
      startX: e.clientX,
      startY: e.clientY,
      startViewportX: 0,
      startViewportY: 0,
      startNodeX: node.x,
      startNodeY: node.y,
      nodeId: node.id,
      startScale: viewport.scale,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.mode) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.mode === "pan") {
      setViewport((prev) => ({
        ...prev,
        x: drag.startViewportX + dx,
        y: drag.startViewportY + dy,
      }));
    } else if (drag.mode === "node") {
      const s = drag.startScale;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === drag.nodeId
            ? { ...n, x: drag.startNodeX + dx / s, y: drag.startNodeY + dy / s }
            : n
        )
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.mode = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleToolbarAction = useCallback(
    (actionId: string) => {
      if (actionId === "delete" && selectedId) {
        setNodes((prev) => prev.filter((n) => n.id === selectedId));
        setSelectedId(null);
        return;
      }
      // 其它动作上抛到顶层（带当前选中节点），由 CanvasPageInner 统一分发
      if (selectedNode && onNodeAction) {
        onNodeAction(selectedNode, actionId);
      }
    },
    [selectedId, setNodes, setSelectedId, selectedNode, onNodeAction]
  );

  return (
    <div
      ref={containerRef}
      className="tc-canvas-surface absolute inset-0 z-0 overflow-hidden bg-black select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      <div
        className="tc-canvas-world absolute inset-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        <CanvasBackground />
        {nodes.map((node) =>
          node.type === "text" ? (
            <TextNode
              key={node.id}
              node={node}
              selected={node.id === selectedId}
              onPointerDown={handleNodePointerDown}
            />
          ) : (
            <ImageNode
              key={node.id}
              node={node}
              selected={node.id === selectedId}
              onPointerDown={handleNodePointerDown}
            />
          )
        )}
        {selectedNode && <NodeToolbar node={selectedNode} onAction={handleToolbarAction} />}
      </div>
    </div>
  );
}
