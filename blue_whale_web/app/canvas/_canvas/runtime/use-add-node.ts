import { useCallback, type MutableRefObject, type RefObject } from "react";
import type { CanvasNode, CanvasNodeData, NodeKindId } from "../model";
import { findPlacement, type Rect } from "../placement";

export type CanvasNodeExtra = {
  id?: string;
  width?: number;
  height?: number;
  data?: Partial<CanvasNodeData>;
};
export type AddCanvasNode = (
  kind: NodeKindId,
  extra?: CanvasNodeExtra,
) => string;

export function useAddNode({
  containerRef,
  viewport,
  addNodeFull,
  existingRects,
  extraPlacedRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  viewport: { x: number; y: number; zoom: number };
  addNodeFull: (node: CanvasNode) => void;
  existingRects: () => Rect[];
  extraPlacedRef: MutableRefObject<Rect[]>;
}) {
  return useCallback<AddCanvasNode>(
    (kind, extra) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const worldX = ((rect ? rect.width / 2 : 0) - viewport.x) / viewport.zoom;
      const worldY =
        ((rect ? rect.height / 2 : 0) - viewport.y) / viewport.zoom;
      const width = extra?.width ?? (kind === "text" ? 200 : 256);
      const height = extra?.height ?? (kind === "text" ? 48 : 200);
      const id = extra?.id ?? `n_${Math.random().toString(36).slice(2, 10)}`;
      const position = findPlacement({
        existing: [...existingRects(), ...extraPlacedRef.current],
        anchor: { x: worldX, y: worldY },
        nodeWidth: width,
        nodeHeight: height,
      });
      extraPlacedRef.current.push({
        x: position.x,
        y: position.y,
        width,
        height,
      });
      addNodeFull({
        id,
        type: kind,
        position,
        width,
        height,
        data: { kind, ...(extra?.data ?? {}) },
      });
      return id;
    },
    [addNodeFull, containerRef, existingRects, extraPlacedRef, viewport],
  );
}
