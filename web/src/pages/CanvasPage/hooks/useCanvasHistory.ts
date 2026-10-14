import { useRef, useState, useCallback } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { CanvasGroup, GroupFrameDragResult } from '../canvasGroups';

const MAX_HISTORY = 50;

export interface CanvasHistoryHandles {
  getTextNodes: () => Node[];
  getMediaNodes: () => Node[];
  getProductNodes: () => Node[];
  getAssetNodes: () => Node[];
  getEdges: () => Edge[];
  getGroups: () => CanvasGroup[];
  setTextNodes: (updater: (prev: Node[]) => Node[]) => void;
  setMediaNodes: (updater: (prev: Node[]) => Node[]) => void;
  setProductNodes: (updater: (prev: Node[]) => Node[]) => void;
  setAssetNodes: (updater: (prev: Node[]) => Node[]) => void;
  setEdges: (updater: (prev: Edge[]) => Edge[]) => void;
  setGroups: (updater: (prev: CanvasGroup[]) => CanvasGroup[]) => void;
  onNodesRemoved?: (ids: string[]) => void;
  historyRef?: { current: ReturnType<typeof useCanvasHistory> | null };
}

interface PositionRecord {
  id: string;
  x: number;
  y: number;
}

type NodeSlot = 'text' | 'media' | 'product' | 'asset';

const slotOfNodeType = (type: string | undefined): NodeSlot => {
  switch (type) {
    case 'textNode':
      return 'text';
    case 'mediaNode':
      return 'media';
    case 'productNode':
      return 'product';
    case 'assetNode':
      return 'asset';
    default:
      return 'text';
  }
};

type HistoryEntry =
  | { kind: 'move'; oldPositions: PositionRecord[]; newPositions: PositionRecord[] }
  | { kind: 'delete'; nodes: Node[]; edges: Edge[]; edgeState?: { before: Edge[]; after: Edge[] }; groupsBefore?: CanvasGroup[]; groupsAfter?: CanvasGroup[] }
  | { kind: 'addNodes'; ids: string[]; nodes: Node[] | null }
  | { kind: 'addEdges'; edges: Edge[] }
  | { kind: 'replaceEdges'; before: Edge[]; after: Edge[] }
  | { kind: 'removeEdges'; edges: Edge[] }
  | { kind: 'createGroup'; group: CanvasGroup; groupsBefore: CanvasGroup[]; groupsAfter: CanvasGroup[] }
  | { kind: 'ungroup'; group: CanvasGroup }
  | { kind: 'deleteGroup'; group: CanvasGroup; nodes: Node[]; edges: Edge[] }
  | ({ kind: 'groupMove' } & GroupFrameDragResult)
  | { kind: 'batch'; entries: HistoryEntry[] };

export function useCanvasHistory(handles: CanvasHistoryHandles) {
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const batchDepthRef = useRef(0);
  const batchBufferRef = useRef<HistoryEntry[]>([]);
  const [, bumpVersion] = useState(0);
  const bump = useCallback(() => bumpVersion((v) => v + 1), []);
  const handlesRef = useRef(handles);
  handlesRef.current = handles;

  const setters: Record<NodeSlot, (updater: (prev: Node[]) => Node[]) => void> = {
    text: (u) => handlesRef.current.setTextNodes(u),
    media: (u) => handlesRef.current.setMediaNodes(u),
    product: (u) => handlesRef.current.setProductNodes(u),
    asset: (u) => handlesRef.current.setAssetNodes(u),
  };
  const slots = Object.keys(setters) as NodeSlot[];

  const commitEntry = useCallback(
    (entry: HistoryEntry) => {
      undoStack.current.push(entry);
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
      bump();
    },
    [bump],
  );

  const push = useCallback(
    (entry: HistoryEntry) => {
      if (batchDepthRef.current > 0) {
        batchBufferRef.current.push(entry);
        return;
      }
      commitEntry(entry);
    },
    [commitEntry],
  );

  const beginBatch = useCallback(() => {
    batchDepthRef.current += 1;
  }, []);

  const endBatch = useCallback(() => {
    if (batchDepthRef.current === 0) return;
    batchDepthRef.current -= 1;
    if (batchDepthRef.current > 0) return;
    const entries = batchBufferRef.current;
    batchBufferRef.current = [];
    if (entries.length === 0) return;
    if (entries.length === 1) {
      commitEntry(entries[0]);
      return;
    }
    commitEntry({ kind: 'batch', entries });
  }, [commitEntry]);

  const allCurrentNodes = (): Node[] => {
    const h = handlesRef.current;
    return [...h.getTextNodes(), ...h.getMediaNodes(), ...h.getProductNodes(), ...h.getAssetNodes()];
  };

  const collectPositions = (ids: Set<string>): PositionRecord[] =>
    allCurrentNodes()
      .filter((n) => ids.has(n.id))
      .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));

  const applyPositions = (positions: PositionRecord[]) => {
    const byId = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
    const apply = (prev: Node[]) =>
      prev.map((n) => {
        const p = byId.get(n.id);
        return p ? { ...n, position: { x: p.x, y: p.y } } : n;
      });
    slots.forEach((slot) => setters[slot](apply));
  };

  const removeNodeIds = (ids: string[]) => {
    const idSet = new Set(ids);
    const filter = (prev: Node[]) => prev.filter((n) => !idSet.has(n.id));
    slots.forEach((slot) => setters[slot](filter));
    handlesRef.current.onNodesRemoved?.(ids);
  };

  const readdNodes = (nodes: Node[]) => {
    const bySlot = new Map<NodeSlot, Node[]>();
    nodes.forEach((n) => {
      const slot = slotOfNodeType(n.type);
      const list = bySlot.get(slot) ?? [];
      list.push(n);
      bySlot.set(slot, list);
    });
    bySlot.forEach((list, slot) => {
      setters[slot]((prev) => {
        const existing = new Set(prev.map((n) => n.id));
        const missing = list.filter((n) => !existing.has(n.id));
        return missing.length > 0 ? [...prev, ...missing] : prev;
      });
    });
  };

  const readdEdges = (edges: Edge[]) => {
    handlesRef.current.setEdges((prev) => {
      const existing = new Set(prev.map((e) => e.id));
      const missing = edges.filter((e) => !existing.has(e.id));
      return missing.length > 0 ? [...prev, ...missing] : prev;
    });
  };

  const removeEdges = (edges: Edge[]) => {
    const idSet = new Set(edges.map((e) => e.id));
    handlesRef.current.setEdges((prev) => prev.filter((e) => !idSet.has(e.id)));
  };

  const undoEntry = (entry: HistoryEntry): HistoryEntry => {
    switch (entry.kind) {
      case 'replaceEdges': {
        handlesRef.current.setEdges(() => entry.before);
        return entry;
      }
      case 'move': {
        entry.newPositions = collectPositions(new Set(entry.oldPositions.map((p) => p.id)));
        applyPositions(entry.oldPositions);
        return entry;
      }
      case 'delete': {
        readdNodes(entry.nodes);
        if (entry.edgeState) handlesRef.current.setEdges(() => entry.edgeState!.before);
        else readdEdges(entry.edges);
        if (entry.groupsBefore) handlesRef.current.setGroups(() => entry.groupsBefore!);
        return entry;
      }
      case 'addNodes': {
        entry.nodes = allCurrentNodes().filter((n) => entry.ids.includes(n.id));
        removeNodeIds(entry.ids);
        return entry;
      }
      case 'addEdges': {
        removeEdges(entry.edges);
        return entry;
      }
      case 'removeEdges': {
        readdEdges(entry.edges);
        return entry;
      }
      case 'createGroup': {
        handlesRef.current.setGroups(() => entry.groupsBefore);
        return entry;
      }
      case 'ungroup': {
        handlesRef.current.setGroups((prev) =>
          prev.some((g) => g.id === entry.group.id)
            ? prev
            : [...prev, entry.group],
        );
        return entry;
      }
      case 'deleteGroup': {
        readdNodes(entry.nodes);
        readdEdges(entry.edges);
        handlesRef.current.setGroups((prev) =>
          prev.some((g) => g.id === entry.group.id)
            ? prev
            : [...prev, entry.group],
        );
        return entry;
      }
      case 'groupMove': {
        applyPositions(entry.nodeOld);
        handlesRef.current.setGroups((prev) =>
          prev.map((g) => {
            if (g.id === entry.groupId) {
              return { ...g, box: { ...entry.oldBox }, excludedIds: [...entry.excludedBefore] };
            }
            const peer = entry.peerExclusions?.find((p) => p.groupId === g.id);
            return peer ? { ...g, excludedIds: [...peer.excludedBefore] } : g;
          }),
        );
        return entry;
      }
      case 'batch': {
        for (let i = entry.entries.length - 1; i >= 0; i -= 1) {
          entry.entries[i] = undoEntry(entry.entries[i]);
        }
        return entry;
      }
    }
  };

  const redoEntry = (entry: HistoryEntry) => {
    switch (entry.kind) {
      case 'replaceEdges':
        handlesRef.current.setEdges(() => entry.after);
        return;
      case 'move':
        applyPositions(entry.newPositions);
        return;
      case 'delete':
        removeNodeIds(entry.nodes.map((n) => n.id));
        if (entry.edgeState) handlesRef.current.setEdges(() => entry.edgeState!.after);
        else removeEdges(entry.edges);
        if (entry.groupsAfter) handlesRef.current.setGroups(() => entry.groupsAfter!);
        return;
      case 'addNodes':
        if (entry.nodes) readdNodes(entry.nodes);
        return;
      case 'addEdges':
        readdEdges(entry.edges);
        return;
      case 'removeEdges':
        removeEdges(entry.edges);
        return;
      case 'createGroup':
        handlesRef.current.setGroups(() => entry.groupsAfter);
        return;
      case 'ungroup':
        handlesRef.current.setGroups((prev) => prev.filter((g) => g.id !== entry.group.id));
        return;
      case 'deleteGroup':
        removeNodeIds(entry.nodes.map((n) => n.id));
        removeEdges(entry.edges);
        handlesRef.current.setGroups((prev) => prev.filter((g) => g.id !== entry.group.id));
        return;
      case 'groupMove':
        applyPositions(entry.nodeNew);
        handlesRef.current.setGroups((prev) =>
          prev.map((g) => {
            if (g.id === entry.groupId) {
              return { ...g, box: { ...entry.newBox }, excludedIds: [...entry.excludedAfter] };
            }
            const peer = entry.peerExclusions?.find((p) => p.groupId === g.id);
            return peer ? { ...g, excludedIds: [...peer.excludedAfter] } : g;
          }),
        );
        return;
      case 'batch':
        entry.entries.forEach(redoEntry);
        return;
    }
  };

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(undoEntry(entry));
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);
    redoEntry(entry);
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump]);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    batchDepthRef.current = 0;
    batchBufferRef.current = [];
    bump();
  }, [bump]);

  const pushMove = useCallback(
    (oldPositions: PositionRecord[]) => {
      if (oldPositions.length === 0) return;
      push({ kind: 'move', oldPositions, newPositions: [] });
    },
    [push],
  );

  const pushDelete = useCallback(
    (
      nodes: Node[],
      edges: Edge[],
      groups?: { before: CanvasGroup[]; after: CanvasGroup[] },
      edgeState?: { before: Edge[]; after: Edge[] },
    ) => {
      if (nodes.length === 0 && edges.length === 0) return;
      push({
        kind: 'delete',
        nodes,
        edges,
        edgeState,
        ...(groups ? { groupsBefore: groups.before, groupsAfter: groups.after } : {}),
      });
    },
    [push],
  );

  const pushAddNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      push({ kind: 'addNodes', ids, nodes: null });
    },
    [push],
  );

  const pushAddEdges = useCallback(
    (edges: Edge[]) => {
      if (edges.length === 0) return;
      push({ kind: 'addEdges', edges });
    },
    [push],
  );

  const pushRemoveEdges = useCallback(
    (edges: Edge[]) => {
      if (edges.length === 0) return;
      push({ kind: 'removeEdges', edges });
    },
    [push],
  );

  const pushCreateGroup = useCallback(
    (group: CanvasGroup, groupsBefore: CanvasGroup[], groupsAfter: CanvasGroup[]) => {
      push({ kind: 'createGroup', group, groupsBefore, groupsAfter });
    },
    [push],
  );

  const pushUngroup = useCallback(
    (group: CanvasGroup) => {
      push({ kind: 'ungroup', group });
    },
    [push],
  );

  const pushDeleteGroup = useCallback(
    (group: CanvasGroup, nodes: Node[], edges: Edge[]) => {
      push({ kind: 'deleteGroup', group, nodes, edges });
    },
    [push],
  );

  const pushGroupMove = useCallback(
    (res: GroupFrameDragResult) => {
      push({ kind: 'groupMove', ...res });
    },
    [push],
  );

  const historyApi = {
    undo,
    redo,
    clear,
    beginBatch,
    endBatch,
    pushMove,
    pushDelete,
    pushAddNodes,
    pushReplaceEdges: (before: Edge[], after: Edge[]) => {
      if (JSON.stringify(before) !== JSON.stringify(after)) push({ kind: 'replaceEdges', before, after });
    },
    pushAddEdges,
    pushRemoveEdges,
    pushCreateGroup,
    pushUngroup,
    pushDeleteGroup,
    pushGroupMove,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
  if (handles.historyRef) handles.historyRef.current = historyApi;
  return historyApi;
}

export type CanvasHistoryApi = ReturnType<typeof useCanvasHistory>;
