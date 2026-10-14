import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import { applyDraggedNodesToGroups, type CanvasGroup } from '../canvasGroups';
import type { CanvasGraph } from './useCanvasGraph';

export interface CanvasNodeDragHandlersHost {
  graph: CanvasGraph;
  groupsRef: RefObject<CanvasGroup[]>;
  historyRef: RefObject<{ pushMove: (positions: Array<{ id: string; x: number; y: number }>) => void } | null>;
  handleCanvasNodeClick: (node: Node) => void;
  setGroups: Dispatch<SetStateAction<CanvasGroup[]>>;
}

export interface CanvasNodeDragHandlersHandles {
  handleNodeDragStop: (_node: Node, draggedNodes: Node[]) => void;
}

export function useCanvasNodeDragHandlers(host: CanvasNodeDragHandlersHost): CanvasNodeDragHandlersHandles {
  const {
    graph,
    groupsRef,
    historyRef,
    handleCanvasNodeClick,
    setGroups,
  } = host;

  const handleNodeDragStop = (_node: Node, draggedNodes: Node[]) => {
    if (draggedNodes.length === 1) {
      const dragged = draggedNodes[0]!;
      const before = graph.findNode(dragged.id);
      const data = (dragged.data ?? {}) as Record<string, unknown>;
      if (
        before
        && Math.abs(dragged.position.x - before.position.x) <= 4
        && Math.abs(dragged.position.y - before.position.y) <= 4
        && (data.imageEnhance || data.videoEnhance)
      ) {
        handleCanvasNodeClick(dragged);
      }
    }
    const positions = new Map(draggedNodes.map((n) => [n.id, n.position]));
    const before = graph.allNodes();
    const oldPositions = before
      .filter((n) => {
        const next = positions.get(n.id);
        return next && (n.position.x !== next.x || n.position.y !== next.y);
      })
      .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    historyRef.current?.pushMove(oldPositions);
    const applyDraggedPositions = (prev: Node[]) =>
      prev.map((n) => {
        const position = positions.get(n.id);
        return position ? { ...n, position } : n;
      });
    graph.setAll(applyDraggedPositions);
    if (groupsRef.current.length > 0) {
      setGroups((prev) => applyDraggedNodesToGroups(prev, before, draggedNodes, positions));
    }
  };

  return { handleNodeDragStop };
}
