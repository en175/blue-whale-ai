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
import {
  parse,
  serialize,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasDoc,
  type CanvasEdge,
} from "../model";

type Viewport = { x: number; y: number; zoom: number };
const DEFAULT_VP: Viewport = { x: 0, y: 0, zoom: 1 };
const SAVE_DEBOUNCE_MS = 800;

function mergeById<T extends { id: string }>(loaded: T[], local: T[]): T[] {
  const localIds = new Set(local.map((item) => item.id));
  return [...loaded.filter((item) => !localIds.has(item.id)), ...local];
}

export type SaveState = "idle" | "saving" | "saved";
export type CanvasLoadState = "loading" | "ready" | "error";

export type CanvasDocApi = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  saveState: SaveState;
  loadState: CanvasLoadState;
  onNodesChange(changes: NodeChange[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(connection: Connection): void;
  addNodeFull(node: CanvasNode): void;
  addEdgeFull(edge: CanvasEdge): void;
  patchNode(id: string, patch: Partial<CanvasNodeData>, options?: { persist?: boolean }): void;
  resizeNode(id: string, width: number, height: number): void;
  patchNodeAndSave(id: string, patch: Partial<CanvasNodeData>): Promise<void>;
  setNodes(nodes: CanvasNode[]): void;
  setViewport(vp: Viewport): void;
  load(
    projectId: string,
  ): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: Viewport }>;
};

export function useCanvasDoc(): CanvasDocApi {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VP);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadState, setLoadState] = useState<CanvasLoadState>("loading");

  const projectIdRef = useRef<string | null>(null);
  const nodesRef = useRef<CanvasNode[]>(nodes);
  const edgesRef = useRef<CanvasEdge[]>(edges);
  const vpRef = useRef<Viewport>(viewport);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGenerationRef = useRef(0);
  const hydratingGenerationRef = useRef<number | null>(null);
  const pendingPersistRef = useRef(false);
  const pendingImmediateSaveRef = useRef(false);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  useEffect(() => {
    vpRef.current = viewport;
  }, [viewport]);
  useEffect(
    () => () => {
      loadGenerationRef.current += 1;
      hydratingGenerationRef.current = null;
      pendingPersistRef.current = false;
      pendingImmediateSaveRef.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const saveSnapshot = useCallback(
    async (snapshot: {
      projectId: string;
      generation: number;
      nodes: CanvasNode[];
      edges: CanvasEdge[];
      viewport: Viewport;
    }) => {
      if (
        projectIdRef.current === snapshot.projectId &&
        loadGenerationRef.current === snapshot.generation
      ) {
        setSaveState("saving");
      }
      const doc: CanvasDoc = {
        id: "",
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        version: 1,
      };
      try {
        await saveCanvas(
          Number(snapshot.projectId),
          JSON.stringify(snapshot.viewport),
          serialize(doc),
        );
        if (
          projectIdRef.current === snapshot.projectId &&
          loadGenerationRef.current === snapshot.generation
        ) {
          setSaveState("saved");
        }
      } catch {
        if (
          projectIdRef.current === snapshot.projectId &&
          loadGenerationRef.current === snapshot.generation
        ) {
          setSaveState("idle");
        }
      }
    },
    [],
  );

  const saveNow = useCallback(
    async (nextNodes: CanvasNode[] = nodesRef.current) => {
      const projectId = projectIdRef.current;
      if (!projectId) return;
      const generation = loadGenerationRef.current;
      if (hydratingGenerationRef.current === generation) {
        pendingPersistRef.current = true;
        pendingImmediateSaveRef.current = true;
        return;
      }
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await saveSnapshot({
        projectId,
        generation,
        nodes: nextNodes,
        edges: edgesRef.current,
        viewport: vpRef.current,
      });
    },
    [saveSnapshot],
  );

  const persist = useCallback(() => {
    const projectId = projectIdRef.current;
    if (!projectId) return;
    const generation = loadGenerationRef.current;
    if (hydratingGenerationRef.current === generation) {
      pendingPersistRef.current = true;
      return;
    }
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      if (
        projectIdRef.current !== projectId ||
        loadGenerationRef.current !== generation
      ) {
        return;
      }
      void saveSnapshot({
        projectId,
        generation,
        nodes: nodesRef.current,
        edges: edgesRef.current,
        viewport: vpRef.current,
      });
    }, SAVE_DEBOUNCE_MS);
  }, [saveSnapshot]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((prev) => {
        const next = applyNodeChanges(
          changes,
          prev as unknown as never[],
        ) as unknown as CanvasNode[];
        nodesRef.current = next;
        if (changes.some((c) => c.type === "position" || c.type === "remove"))
          persist();
        return next;
      });
    },
    [persist],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((prev) => {
        const next = applyEdgeChanges(
          changes,
          prev as unknown as never[],
        ) as unknown as CanvasEdge[];
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
        const next = addEdge(
          connection,
          prev as unknown as never[],
        ) as unknown as CanvasEdge[];
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
    (id: string, patch: Partial<CanvasNodeData>, options?: { persist?: boolean }) => {
      setNodes((prev) => {
        const next = prev.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
        );
        nodesRef.current = next;
        // persist 默认 true；progress 等瞬时态传 { persist: false } 避免「每轮轮询都 PUT 整张画布」。
        if (options?.persist !== false) persist();
        return next;
      });
    },
    [persist],
  );

  const resizeNode = useCallback(
    (id: string, width: number, height: number) => {
      setNodes((prev) => {
        const next = prev.map((node) =>
          node.id === id ? { ...node, width, height } : node,
        );
        nodesRef.current = next;
        persist();
        return next;
      });
    },
    [persist],
  );

  const patchNodeAndSave = useCallback(
    async (id: string, patch: Partial<CanvasNodeData>) => {
      const next = nodesRef.current.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
      );
      nodesRef.current = next;
      setNodes(next);
      await saveNow(next);
    },
    [saveNow],
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

  const load = useCallback(
    async (projectId: string) => {
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      hydratingGenerationRef.current = generation;
      pendingPersistRef.current = false;
      pendingImmediateSaveRef.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      projectIdRef.current = projectId;
      nodesRef.current = [];
      edgesRef.current = [];
      vpRef.current = DEFAULT_VP;
      setNodes([]);
      setEdges([]);
      setViewport(DEFAULT_VP);
      setSaveState("idle");
      setLoadState("loading");

      try {
        const dto = await loadCanvas(Number(projectId));
        if (
          projectIdRef.current !== projectId ||
          loadGenerationRef.current !== generation
        ) {
          return {
            nodes: nodesRef.current,
            edges: edgesRef.current,
            viewport: vpRef.current,
          };
        }
        const doc = parse(dto.nodes);
        // 去重：防 persist 脏数据同 id 重复（历史 recover 未去重遗留）致 RF id 冲突/toolbar 错乱
        const loadedNodes = doc.nodes.filter(
          (n, i, arr) => arr.findIndex((x) => x.id === n.id) === i,
        );
        const nodes = mergeById(loadedNodes, nodesRef.current);
        const edges = mergeById(doc.edges, edgesRef.current);
        const vp: Viewport = dto.viewport
          ? JSON.parse(dto.viewport)
          : DEFAULT_VP;
        nodesRef.current = nodes;
        edgesRef.current = edges;
        vpRef.current = vp;
        const shouldPersist = pendingPersistRef.current;
        const shouldSaveImmediately = pendingImmediateSaveRef.current;
        hydratingGenerationRef.current = null;
        pendingPersistRef.current = false;
        pendingImmediateSaveRef.current = false;
        setNodes(nodes);
        setEdges(edges);
        setViewport(vp);
        setSaveState("idle");
        setLoadState("ready");
        if (shouldSaveImmediately) await saveNow(nodes);
        else if (shouldPersist) persist();
        return { nodes, edges, viewport: vp };
      } catch (error) {
        if (
          projectIdRef.current === projectId &&
          loadGenerationRef.current === generation
        ) {
          hydratingGenerationRef.current = null;
          pendingPersistRef.current = false;
          pendingImmediateSaveRef.current = false;
          setSaveState("idle");
          setLoadState("error");
        }
        throw error;
      }
    },
    [persist, saveNow],
  );

  return {
    nodes,
    edges,
    viewport,
    saveState,
    loadState,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNodeFull,
    addEdgeFull,
    patchNode,
    resizeNode,
    patchNodeAndSave,
    setNodes: setNodesOverride,
    setViewport: setViewportOverride,
    load,
  };
}
