"use client";
/**
 * useCanvasDoc —— 画布文档 hook（nodes/edges/viewport/save/load，React state）。
 *
 * canvas 操作数据走 React state（本地，高频拖拽/连线不卡），**不走 zustand**（zustand 只存
 * 业务/接口数据如 assets 缓存）。
 * save 800ms debounce 调 lib/canvas（serialize 产 NodeItem[]，edges 聚合到 references 兼容老）。
 * load 返回 parsed doc（含 edges；调用方按节点 assetId 调 store.ensureAsset）。
 */
import { useState, useCallback, useRef, useEffect } from "react";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import { loadCanvas, saveCanvas } from "../../../../lib/canvas";
import { parse, serialize, type CanvasNode, type CanvasNodeData, type CanvasDoc, type CanvasEdge } from "../model";

type Viewport = { x: number; y: number; zoom: number };
const DEFAULT_VP: Viewport = { x: 0, y: 0, zoom: 1 };
const SAVE_DEBOUNCE_MS = 800;

export type SaveState = "idle" | "saving" | "saved";

export type CanvasDocApi = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  saveState: SaveState;
  onNodesChange(changes: NodeChange[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(connection: Connection): void;
  addNodeFull(node: CanvasNode): void;
  addEdgeFull(edge: CanvasEdge): void;
  patchNode(id: string, patch: Partial<CanvasNodeData>): void;
  setNodes(nodes: CanvasNode[]): void;
  setViewport(vp: Viewport): void;
  load(projectId: string): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: Viewport }>;
};

export function useCanvasDoc(): CanvasDocApi {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VP);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const projectIdRef = useRef<string | null>(null);
  const nodesRef = useRef<CanvasNode[]>(nodes);
  const edgesRef = useRef<CanvasEdge[]>(edges);
  const vpRef = useRef<Viewport>(viewport);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  useEffect(() => {
    vpRef.current = viewport;
  }, [viewport]);

  const persist = useCallback(() => {
    const pid = projectIdRef.current;
    if (!pid) return;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const doc: CanvasDoc = { id: "", nodes: nodesRef.current, edges: edgesRef.current, version: 1 };
      try {
        await saveCanvas(Number(pid), JSON.stringify(vpRef.current), serialize(doc));
        setSaveState("saved");
      } catch {
        setSaveState("idle");
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((prev) => {
        const next = applyNodeChanges(changes, prev as unknown as never[]) as unknown as CanvasNode[];
        nodesRef.current = next;
        if (changes.some((c) => c.type === "position" || c.type === "remove")) persist();
        return next;
      });
    },
    [persist],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((prev) => {
        const next = applyEdgeChanges(changes, prev as unknown as never[]) as unknown as CanvasEdge[];
        edgesRef.current = next;
        persist();
        return next;
      });
    },
    [persist],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((prev) => {
        const next = addEdge(connection, prev as unknown as never[]) as unknown as CanvasEdge[];
        edgesRef.current = next;
        persist();
        return next;
      });
    },
    [persist],
  );

  const addNodeFull = useCallback(
    (node: CanvasNode) => {
      setNodes((prev) => {
        const next = [...prev, node];
        nodesRef.current = next;
        persist();
        return next;
      });
    },
    [persist],
  );

  const addEdgeFull = useCallback(
    (edge: CanvasEdge) => {
      setEdges((prev) => {
        const next = [...prev, edge];
        edgesRef.current = next;
        persist();
        return next;
      });
    },
    [persist],
  );

  const patchNode = useCallback(
    (id: string, patch: Partial<CanvasNodeData>) => {
      setNodes((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
        nodesRef.current = next;
        persist();
        return next;
      });
    },
    [persist],
  );

  const setNodesOverride = useCallback(
    (next: CanvasNode[]) => {
      nodesRef.current = next;
      persist();
      setNodes(next);
    },
    [persist],
  );

  const setViewportOverride = useCallback(
    (vp: Viewport) => {
      vpRef.current = vp;
      persist();
      setViewport(vp);
    },
    [persist],
  );

  const load = useCallback(async (projectId: string) => {
    projectIdRef.current = projectId;
    const dto = await loadCanvas(Number(projectId));
    const doc = parse(dto.nodes);
    const vp: Viewport = dto.viewport ? JSON.parse(dto.viewport) : DEFAULT_VP;
    nodesRef.current = doc.nodes;
    edgesRef.current = doc.edges;
    vpRef.current = vp;
    setNodes(doc.nodes);
    setEdges(doc.edges);
    setViewport(vp);
    setSaveState("idle");
    return { nodes: doc.nodes, edges: doc.edges, viewport: vp };
  }, []);

  return {
    nodes,
    edges,
    viewport,
    saveState,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNodeFull,
    addEdgeFull,
    patchNode,
    setNodes: setNodesOverride,
    setViewport: setViewportOverride,
    load,
  };
}
