"use client";
/**
 * useCanvasDoc —— 画布文档 hook（nodes/edges/viewport/save/load，React state）。
 *
 * canvas 操作数据走 React state（本地，高频拖拽/连线不卡），**不走 zustand**（zustand 只存
 * 业务/接口数据如 assets 缓存）。
 * save 800ms debounce 调 lib/canvas（serialize 产 NodeItem[]，edges 聚合到 references 兼容老）。
 * load 返回 parsed doc（含 edges；调用方按节点 assetId 调 store.ensureAsset）。
 *
 * IK76K1：新增 undo/redo 历史栈，覆盖节点删除与节点移动；最多 20 步，不跨会话。
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
import { wireInteger } from "@/lib/wire-integer";
import {
  parse,
  serialize,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasDoc,
  type CanvasEdge,
} from "../model";
import { toast } from "@/components/Toast";

type Viewport = { x: number; y: number; zoom: number };
const DEFAULT_VP: Viewport = { x: 0, y: 0, zoom: 1 };
const SAVE_DEBOUNCE_MS = 800;

// IK76K1：撤销/重做栈
const MAX_UNDO_STEPS = 20;
type CanvasSnapshot = { nodes: CanvasNode[]; edges: CanvasEdge[] };

function mergeById<T extends { id: string }>(loaded: T[], local: T[]): T[] {
  const localIds = new Set(local.map((item) => item.id));
  return [...loaded.filter((item) => !localIds.has(item.id)), ...local];
}

function markDuplicateSceneCards(nodes: CanvasNode[]): CanvasNode[] {
  const seenNodeIds = new Set<string>();
  const seenSceneCardIds = new Set<string>();
  return nodes.flatMap((node, index) => {
    const sceneCardId = node.data.sceneCardId;
    const isSceneCard = node.data.kind === "scene_card" && Boolean(sceneCardId);
    const duplicateNodeId = seenNodeIds.has(node.id);
    if (!isSceneCard) {
      if (duplicateNodeId) return [];
      seenNodeIds.add(node.id);
      return [node];
    }
    const duplicateSceneCard = seenSceneCardIds.has(sceneCardId!);
    seenSceneCardIds.add(sceneCardId!);
    if (!duplicateNodeId && !duplicateSceneCard) {
      seenNodeIds.add(node.id);
      return [node];
    }
    let recoveredId = `${node.id}:duplicate:${index}`;
    while (seenNodeIds.has(recoveredId)) recoveredId += ":duplicate";
    seenNodeIds.add(recoveredId);
    return [
      {
        ...node,
        id: recoveredId,
        data: duplicateSceneCard
          ? { ...node.data, unavailableReason: "duplicate" }
          : node.data,
      },
    ];
  });
}

export type SaveState = "idle" | "saving" | "saved" | "error";
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
  patchNode(
    id: string,
    patch: Partial<CanvasNodeData>,
    options?: { persist?: boolean },
  ): void;
  resizeNode(id: string, width: number, height: number): void;
  patchNodeAndSave(id: string, patch: Partial<CanvasNodeData>): Promise<void>;
  removeNodeAndSave(id: string): Promise<boolean>;
  setNodes(nodes: CanvasNode[]): void;
  setViewport(vp: Viewport): void;
  load(
    projectId: string,
  ): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: Viewport }>;
  // IK76K1：撤销/重做
  pushUndo(): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
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
  const versionRef = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGenerationRef = useRef(0);
  const hydratingGenerationRef = useRef<number | null>(null);
  const pendingPersistRef = useRef(false);
  const pendingImmediateSaveRef = useRef(false);
  // IK76K1：撤销/重做栈
  const undoStackRef = useRef<CanvasSnapshot[]>([]);
  const redoStackRef = useRef<CanvasSnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

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
    }): Promise<boolean> => {
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
        const saved = await saveCanvas(
          wireInteger(snapshot.projectId),
          JSON.stringify(snapshot.viewport),
          serialize(doc),
          versionRef.current,
        );
        if (
          projectIdRef.current === snapshot.projectId &&
          loadGenerationRef.current === snapshot.generation
        ) {
          if (saved?.version !== undefined) {
            versionRef.current = saved.version;
          }
          setSaveState("saved");
        }
        return true;
      } catch {
        if (
          projectIdRef.current === snapshot.projectId &&
          loadGenerationRef.current === snapshot.generation
        ) {
          setSaveState("error");
        }
        return false;
      }
    },
    [],
  );

  const saveNow = useCallback(
    async (
      nextNodes: CanvasNode[] = nodesRef.current,
      nextEdges: CanvasEdge[] = edgesRef.current,
    ): Promise<boolean> => {
      const projectId = projectIdRef.current;
      if (!projectId) return false;
      const generation = loadGenerationRef.current;
      if (hydratingGenerationRef.current === generation) {
        pendingPersistRef.current = true;
        pendingImmediateSaveRef.current = true;
        return false;
      }
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return saveSnapshot({
        projectId,
        generation,
        nodes: nextNodes,
        edges: nextEdges,
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

  // IK76K1：撤销/重做实现。
  // IK7ZME：定义上移到 onNodesChange 之前，消费方直接捕获——原先的
  // pushUndoRef/undoRef「render 期同步 latest 闭包」写法违反 react-hooks
  // immutability/refs 规则，且被下方回调捕获后再赋值会被编译器拒绝。
  const pushUndo = useCallback(() => {
    const snapshot: CanvasSnapshot = {
      nodes: JSON.parse(JSON.stringify(nodesRef.current)),
      edges: JSON.parse(JSON.stringify(edgesRef.current)),
    };
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO_STEPS - 1)), snapshot];
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    const current: CanvasSnapshot = {
      nodes: JSON.parse(JSON.stringify(nodesRef.current)),
      edges: JSON.parse(JSON.stringify(edgesRef.current)),
    };
    redoStackRef.current = [...redoStackRef.current, current];
    nodesRef.current = prev.nodes;
    edgesRef.current = prev.edges;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    persist();
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, [persist]);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    const current: CanvasSnapshot = {
      nodes: JSON.parse(JSON.stringify(nodesRef.current)),
      edges: JSON.parse(JSON.stringify(edgesRef.current)),
    };
    undoStackRef.current = [...undoStackRef.current, current];
    nodesRef.current = next.nodes;
    edgesRef.current = next.edges;
    setNodes(next.nodes);
    setEdges(next.edges);
    persist();
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, [persist]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // IK76K1：删除操作前记入撤销栈（右键菜单删除、键盘 Backspace/Delete 均走此路径）
      const removeChanges = changes.filter((c) => c.type === "remove");
      if (removeChanges.length > 0) {
        pushUndo();
        // IK76K1：删除后弹出带撤销按钮的 toast（数量由 remove 变更数决定）
        const count = removeChanges.length;
        toast.info(
          `已删除 ${count} 个节点`,
          { label: "撤销", onClick: () => undo() },
          3000,
        );
      }
      setNodes((prev) => {
        const changedSceneCardSizes = new Map(
          changes.flatMap((change) =>
            change.type === "dimensions" && change.dimensions
              ? [[change.id, change.dimensions] as const]
              : [],
          ),
        );
        const applied = applyNodeChanges(
          changes,
          prev as unknown as never[],
        ) as unknown as CanvasNode[];
        let sceneCardSizeChanged = false;
        const next = applied.map((node) => {
          const dimensions = changedSceneCardSizes.get(node.id);
          if (!dimensions || node.data.kind !== "scene_card") return node;
          if (
            node.width === dimensions.width &&
            node.height === dimensions.height
          )
            return node;
          sceneCardSizeChanged = true;
          return {
            ...node,
            width: dimensions.width,
            height: dimensions.height,
          };
        });
        nodesRef.current = next;
        if (
          sceneCardSizeChanged ||
          changes.some((c) => c.type === "position" || c.type === "remove")
        )
          persist();
        return next;
      });
    },
    [persist, pushUndo, undo],
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
    (
      id: string,
      patch: Partial<CanvasNodeData>,
      options: { persist?: boolean } = {},
    ) => {
      setNodes((prev) => {
        const next = prev.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
        );
        nodesRef.current = next;
        // 默认为持久化；轮询进度等瞬时态显式关闭。
        if (options.persist !== false) persist();
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

  const removeNodeAndSave = useCallback(
    async (id: string) => {
      const currentNodes = nodesRef.current;
      if (!currentNodes.some((node) => node.id === id)) return true;
      // IK76K1：删除前记入撤销栈
      pushUndo();
      // IK76K1：场景卡删除 toast
      const sceneCardNode = currentNodes.find((node) => node.id === id);
      const isSceneCard = sceneCardNode?.data.kind === "scene_card";
      if (isSceneCard) {
        toast.info(
          "已删除 1 个节点",
          { label: "撤销", onClick: () => undo() },
          3000,
        );
      }
      const nextNodes = currentNodes.filter((node) => node.id !== id);
      const nextEdges = edgesRef.current.filter(
        (edge) => edge.source !== id && edge.target !== id,
      );
      const saved = await saveNow(nextNodes, nextEdges);
      if (!saved) {
        const unavailableNodes = currentNodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: { ...node.data, unavailableReason: "deleted" },
              }
            : node,
        );
        nodesRef.current = unavailableNodes;
        setNodes(unavailableNodes);
        return false;
      }
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      return true;
    },
    [saveNow, pushUndo, undo],
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
      versionRef.current = null;
      nodesRef.current = [];
      edgesRef.current = [];
      vpRef.current = DEFAULT_VP;
      setNodes([]);
      setEdges([]);
      setViewport(DEFAULT_VP);
      setSaveState("idle");
      setLoadState("loading");
      // IK76K1：切项目时清空撤销/重做历史栈
      undoStackRef.current = [];
      redoStackRef.current = [];
      setCanUndo(false);
      setCanRedo(false);

      try {
        const dto = await loadCanvas(wireInteger(projectId));
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
        const loadedNodes = markDuplicateSceneCards(doc.nodes);
        const nodes = mergeById(loadedNodes, nodesRef.current);
        const edges = mergeById(doc.edges, edgesRef.current);
        const vp: Viewport = dto.viewport
          ? JSON.parse(dto.viewport)
          : DEFAULT_VP;
        nodesRef.current = nodes;
        edgesRef.current = edges;
        vpRef.current = vp;
        versionRef.current = dto.version ?? null;
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
    removeNodeAndSave,
    setNodes: setNodesOverride,
    setViewport: setViewportOverride,
    load,
    // IK76K1
    pushUndo,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
