import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';

export function useCanvasOrphanEdges(input: {
  textNodes: Node[];
  mediaNodes: Node[];
  productNodes: Node[];
  assetNodes: Node[];
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}): void {
  const { textNodes, mediaNodes, productNodes, assetNodes, setEdges } = input;
  const canvasNodeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(
      [...textNodes, ...mediaNodes, ...productNodes, ...assetNodes].map((n) => n.id),
    );
    const prevIds = canvasNodeIdsRef.current;
    canvasNodeIdsRef.current = ids;
    if (prevIds.size === 0) return;
    const removed = new Set<string>();
    prevIds.forEach((id) => {
      if (!ids.has(id)) removed.add(id);
    });
    if (removed.size === 0) return;
    setEdges((prev) => {
      const next = prev.filter((e) => !removed.has(e.source) && !removed.has(e.target));
      return next.length === prev.length ? prev : next;
    });
  }, [textNodes, mediaNodes, productNodes, assetNodes, setEdges]);
}
