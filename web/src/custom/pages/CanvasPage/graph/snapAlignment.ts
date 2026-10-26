
export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapTarget {
  id: string;
  rect: SnapRect;
}

export type SnapXRelation = 'centerX' | 'left' | 'right';

export type SnapYRelation = 'centerY' | 'top' | 'bottom';

export type SnapRelation = SnapXRelation | SnapYRelation;

export interface SnapGuide {
  orientation: 'horizontal' | 'vertical';
  pos: number;
  from: number;
  to: number;
  targetId: string;
  relation: SnapRelation;
}

export interface SnapAlignmentResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface ComputeSnapAlignmentOptions {
  thresholdPx?: number;
  zoom?: number;
}

export const SNAP_THRESHOLD_PX = 8;

interface AxisHit {
  delta: number;
  relation: SnapRelation;
  target: SnapTarget;
}

function guidePosX(hit: AxisHit): number {
  const r = hit.target.rect;
  if (hit.relation === 'centerX') return r.x + r.width / 2;
  if (hit.relation === 'left') return r.x;
  return r.x + r.width;
}

function guidePosY(hit: AxisHit): number {
  const r = hit.target.rect;
  if (hit.relation === 'centerY') return r.y + r.height / 2;
  if (hit.relation === 'top') return r.y;
  return r.y + r.height;
}

function guideRange(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): { from: number; to: number } {
  return { from: Math.min(aMin, bMin), to: Math.max(aMax, bMax) };
}

export function computeSnapAlignment(
  dragging: SnapRect,
  targets: SnapTarget[],
  options: ComputeSnapAlignmentOptions = {},
): SnapAlignmentResult {
  const thresholdPx = options.thresholdPx ?? SNAP_THRESHOLD_PX;
  const zoom = options.zoom ?? 1;
  const canvasThreshold = thresholdPx / zoom;

  let bestX: AxisHit | null = null;
  let bestY: AxisHit | null = null;
  for (const target of targets) {
    const r = target.rect;
    const xHits: AxisHit[] = [
      { delta: r.x + r.width / 2 - (dragging.x + dragging.width / 2), relation: 'centerX', target },
      { delta: r.x - dragging.x, relation: 'left', target },
      { delta: r.x + r.width - (dragging.x + dragging.width), relation: 'right', target },
    ];
    const yHits: AxisHit[] = [
      { delta: r.y + r.height / 2 - (dragging.y + dragging.height / 2), relation: 'centerY', target },
      { delta: r.y - dragging.y, relation: 'top', target },
      { delta: r.y + r.height - (dragging.y + dragging.height), relation: 'bottom', target },
    ];
    for (const hit of xHits) {
      if (Math.abs(hit.delta) <= canvasThreshold && (bestX == null || Math.abs(hit.delta) < Math.abs(bestX.delta))) {
        bestX = hit;
      }
    }
    for (const hit of yHits) {
      if (Math.abs(hit.delta) <= canvasThreshold && (bestY == null || Math.abs(hit.delta) < Math.abs(bestY.delta))) {
        bestY = hit;
      }
    }
  }

  const guides: SnapGuide[] = [];
  if (bestX != null) {
    const { from, to } = guideRange(
      dragging.y,
      dragging.y + dragging.height,
      bestX.target.rect.y,
      bestX.target.rect.y + bestX.target.rect.height,
    );
    guides.push({ orientation: 'vertical', pos: guidePosX(bestX), from, to, targetId: bestX.target.id, relation: bestX.relation });
  }
  if (bestY != null) {
    const { from, to } = guideRange(
      dragging.x,
      dragging.x + dragging.width,
      bestY.target.rect.x,
      bestY.target.rect.x + bestY.target.rect.width,
    );
    guides.push({ orientation: 'horizontal', pos: guidePosY(bestY), from, to, targetId: bestY.target.id, relation: bestY.relation });
  }
  return { dx: bestX?.delta ?? 0, dy: bestY?.delta ?? 0, guides };
}

export interface SnapNodeLike {
  id: string;
  type?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
}

export function resolveNodeSize(
  node: SnapNodeLike | null | undefined,
): { width: number; height: number } | null {
  const width = node?.measured?.width ?? node?.width;
  const height = node?.measured?.height ?? node?.height;
  if (width == null || height == null) return null;
  return { width, height };
}

export function collectSnapTargets(nodes: SnapNodeLike[], draggingIds: Iterable<string>): SnapTarget[] {
  const dragging = new Set(draggingIds);
  const targets: SnapTarget[] = [];
  for (const node of nodes) {
    if (dragging.has(node.id)) continue;
    const size = resolveNodeSize(node);
    if (size == null) continue;
    targets.push({
      id: node.id,
      rect: { x: node.position.x, y: node.position.y, width: size.width, height: size.height },
    });
  }
  return targets;
}
