/* ============================================
 * useCanvasHistory 画布撤销/重做栈（IKD0JT A2）
 * 命令条目式历史：移动/删除/复制/连线/删边各存撤销所需的精确数据，
 * 成组/解组等后续接入（预留同栈扩展）。撤销栈深度 50（OD-A7 推荐值）。
 * 约束（PRD §7.2）：
 *  - 文本内文字编辑不进栈（move 回退只还原坐标，节点 data 保持当前值）
 *  - 生成任务不回退：生成类节点删除路径不登记（由调用方保证）
 *  - 撤销栈不跨会话（切换项目由调用方 clear）
 * ============================================ */
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
  /** 节点被撤销移除后的通知（清 pending 上传登记等副作用） */
  onNodesRemoved?: (ids: string[]) => void;
}

interface PositionRecord {
  id: string;
  x: number;
  y: number;
}

/** type → 取数/写数通道映射（节点数组的四分类落位） */
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
  /** 删除：undo = 节点连同悬空边塞回；redo = 再次删除。成员删除可能解散组，携带组状态快照 */
  | { kind: 'delete'; nodes: Node[]; edges: Edge[]; groupsBefore?: CanvasGroup[]; groupsAfter?: CanvasGroup[] }
  /** 复制等新增：undo = 移除新节点；redo = 塞回（undo 时快照节点） */
  | { kind: 'addNodes'; ids: string[]; nodes: Node[] | null }
  /** 建立连线：undo = 删边；redo = 加边 */
  | { kind: 'addEdges'; edges: Edge[] }
  /** 删边：undo = 加回；redo = 再删 */
  | { kind: 'removeEdges'; edges: Edge[] }
  /** 成组：undo/redo 均恢复组状态快照（重组会把成员从其他组迁出，需整体回放） */
  | { kind: 'createGroup'; group: CanvasGroup; groupsBefore: CanvasGroup[]; groupsAfter: CanvasGroup[] }
  /** 解组：undo = 重建组；redo = 解散 */
  | { kind: 'ungroup'; group: CanvasGroup }
  /** 删除组（连同成员节点）：undo = 全部塞回；redo = 全部再删 */
  | { kind: 'deleteGroup'; group: CanvasGroup; nodes: Node[]; edges: Edge[] }
  /** 整组拖动：undo/redo 回放矩形、成员位移与排除名单（组盖住的节点） */
  | ({ kind: 'groupMove' } & GroupFrameDragResult);

export function useCanvasHistory(handles: CanvasHistoryHandles) {
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  /** 栈变化时递增触发重渲染（canUndo/canRedo 消费方刷新） */
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

  const push = useCallback(
    (entry: HistoryEntry) => {
      undoStack.current.push(entry);
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
      bump();
    },
    [bump],
  );

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

  /** 撤销一条记录（就地改写 entry 补充 redo 所需的逆向数据） */
  const undoEntry = (entry: HistoryEntry): HistoryEntry => {
    switch (entry.kind) {
      case 'move': {
        entry.newPositions = collectPositions(new Set(entry.oldPositions.map((p) => p.id)));
        applyPositions(entry.oldPositions);
        return entry;
      }
      case 'delete': {
        readdNodes(entry.nodes);
        readdEdges(entry.edges);
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
          prev.map((g) =>
            g.id === entry.groupId
              ? { ...g, box: { ...entry.oldBox }, excludedIds: [...entry.excludedBefore] }
              : g,
          ),
        );
        return entry;
      }
    }
  };

  /** 重做一条记录 */
  const redoEntry = (entry: HistoryEntry) => {
    switch (entry.kind) {
      case 'move':
        applyPositions(entry.newPositions);
        return;
      case 'delete':
        removeNodeIds(entry.nodes.map((n) => n.id));
        removeEdges(entry.edges);
        if (entry.groupsAfter) handlesRef.current.setGroups(() => entry.groupsAfter!);
        return;
      case 'addNodes':
        if (entry.nodes) readdNodes(entry.nodes);
        return;
      case 'addEdges':
        removeEdges(entry.edges);
        return;
      case 'removeEdges':
        readdEdges(entry.edges);
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
          prev.map((g) =>
            g.id === entry.groupId
              ? { ...g, box: { ...entry.newBox }, excludedIds: [...entry.excludedAfter] }
              : g,
          ),
        );
        return;
    }
  };

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(undoEntry(entry));
    bump();
  }, [bump]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);
    redoEntry(entry);
    bump();
  }, [bump]);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    bump();
  }, [bump]);

  /** 移动登记：oldPositions 为拖拽前坐标 */
  const pushMove = useCallback(
    (oldPositions: PositionRecord[]) => {
      if (oldPositions.length === 0) return;
      push({ kind: 'move', oldPositions, newPositions: [] });
    },
    [push],
  );

  /** 删除登记：nodes 为被删节点（含 data），edges 为随之悬空的连线；
   *  成员删除会解散组时携带组状态前后快照（undo/redo 整体回放） */
  const pushDelete = useCallback(
    (
      nodes: Node[],
      edges: Edge[],
      groups?: { before: CanvasGroup[]; after: CanvasGroup[] },
    ) => {
      if (nodes.length === 0 && edges.length === 0) return;
      push({
        kind: 'delete',
        nodes,
        edges,
        ...(groups ? { groupsBefore: groups.before, groupsAfter: groups.after } : {}),
      });
    },
    [push],
  );

  /** 复制登记：ids 为本次新建的副本节点 id */
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

  /** 成组登记：group 新建组；groupsBefore/After 为组状态前后快照（重组含成员迁移） */
  const pushCreateGroup = useCallback(
    (group: CanvasGroup, groupsBefore: CanvasGroup[], groupsAfter: CanvasGroup[]) => {
      push({ kind: 'createGroup', group, groupsBefore, groupsAfter });
    },
    [push],
  );

  /** 解组登记：undo 重建组 */
  const pushUngroup = useCallback(
    (group: CanvasGroup) => {
      push({ kind: 'ungroup', group });
    },
    [push],
  );

  /** 删除组登记（连同成员节点与悬空边） */
  const pushDeleteGroup = useCallback(
    (group: CanvasGroup, nodes: Node[], edges: Edge[]) => {
      push({ kind: 'deleteGroup', group, nodes, edges });
    },
    [push],
  );

  /** 整组拖动登记：直接接收 GroupOverlay 上抛的拖动结果（矩形前后 + 成员位移 + 排除名单前后） */
  const pushGroupMove = useCallback(
    (res: GroupFrameDragResult) => {
      push({ kind: 'groupMove', ...res });
    },
    [push],
  );

  return {
    undo,
    redo,
    clear,
    pushMove,
    pushDelete,
    pushAddNodes,
    pushAddEdges,
    pushRemoveEdges,
    pushCreateGroup,
    pushUngroup,
    pushDeleteGroup,
    pushGroupMove,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}

export type CanvasHistoryApi = ReturnType<typeof useCanvasHistory>;
