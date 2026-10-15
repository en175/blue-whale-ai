import type { CSSProperties } from 'react';

export interface FollowDialogAnchor {
  left: number;
  top: number;
}

export const FOLLOW_DIALOG_WIDTH = 740;
export const FOLLOW_GAP = 16;
export const FOLLOW_PAD = 12;





export function anchoredOverlayStyle(
  anchor: FollowDialogAnchor | null,
  dragHidden?: boolean,
): CSSProperties | undefined {
  if (!anchor) return dragHidden ? { visibility: 'hidden' } : undefined;
  return dragHidden
    ? { left: anchor.left, top: anchor.top, visibility: 'hidden' }
    : { left: anchor.left, top: anchor.top };
}


export function computeFollowAnchor(opts: {
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  nodeHeight: number;
  viewport: { x: number; y: number; zoom: number };
  containerWidth: number;
  containerHeight: number;
  dialogWidth?: number;
  dialogHeight?: number;
}): FollowDialogAnchor {
  const zoom = opts.viewport.zoom || 1;
  const dialogWidth = Math.min(opts.dialogWidth ?? FOLLOW_DIALOG_WIDTH, Math.max(280, opts.containerWidth * 0.9));
  const nodeLeft = opts.nodeX * zoom + opts.viewport.x;
  const nodeWidth = opts.nodeWidth * zoom;
  const nodeHeight = opts.nodeHeight * zoom;
  const nodeBottom = opts.nodeY * zoom + opts.viewport.y + nodeHeight;
  let left = nodeLeft + nodeWidth / 2 - dialogWidth / 2;
  const maxLeft = opts.containerWidth - dialogWidth - FOLLOW_PAD;
  left = Math.max(FOLLOW_PAD, Math.min(left, Math.max(FOLLOW_PAD, maxLeft)));
  return { left: Math.round(left), top: Math.round(nodeBottom + FOLLOW_GAP) };
}


export const FOLLOW_ABOVE_LIFT = 52;









export const FOLLOW_ABOVE_HALF_WIDTH = 341;

export const FOLLOW_ABOVE_MIN_TOP = 8;






export function computeFollowAnchorAbove(opts: {
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  viewport: { x: number; y: number; zoom: number };
  containerWidth: number;
  toolbarHalfWidth?: number;
  toolbarLift?: number;
}): FollowDialogAnchor {
  const zoom = opts.viewport.zoom || 1;
  const halfWidth = opts.toolbarHalfWidth ?? FOLLOW_ABOVE_HALF_WIDTH;
  const lift = opts.toolbarLift ?? FOLLOW_ABOVE_LIFT;
  const centerX = (opts.nodeX + opts.nodeWidth / 2) * zoom + opts.viewport.x;
  const minLeft = FOLLOW_PAD + halfWidth;
  const left = Math.max(minLeft, Math.min(centerX, Math.max(minLeft, opts.containerWidth - halfWidth - FOLLOW_PAD)));
  const top = Math.max(FOLLOW_ABOVE_MIN_TOP, opts.nodeY * zoom + opts.viewport.y - lift);
  return { left: Math.round(left), top: Math.round(top) };
}
