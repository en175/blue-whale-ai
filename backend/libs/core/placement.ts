
export type Rect = { x: number; y: number; width: number; height: number };

export type FindPlacementOptions = {
  existing: Rect[];
  anchor: { x: number; y: number };
  nodeWidth?: number;
  nodeHeight?: number;
  gap?: number;
  maxPerRow?: number;
};

export const DEFAULT_NODE_WIDTH = 200;
export const DEFAULT_NODE_HEIGHT = 200;
export const DEFAULT_GAP = 24;
export const DEFAULT_MAX_PER_ROW = 3;
export const SCENE_CARD_WIDTH = 400;
export const SCENE_CARD_FALLBACK_HEIGHT = 1080;
const SEARCH_ROWS = 50;

export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function overlapsAny(rect: Rect, existing: Rect[]): boolean {
  return existing.some((e) => intersects(rect, e));
}

export function findPlacement(opts: FindPlacementOptions): {
  x: number;
  y: number;
} {
  const { existing, anchor } = opts;
  const nw = opts.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nh = opts.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const gap = opts.gap ?? DEFAULT_GAP;
  const maxPerRow = opts.maxPerRow ?? DEFAULT_MAX_PER_ROW;
  const stepX = nw + gap;
  const stepY = nh + gap;

  const baseX = Math.floor((anchor.x - nw / 2) / stepX) * stepX;
  const baseY = Math.floor((anchor.y - nh / 2) / stepY) * stepY;

  for (let row = 0; row < SEARCH_ROWS; row++) {
    for (let col = 0; col < maxPerRow; col++) {
      const x = baseX + col * stepX;
      const y = baseY + row * stepY;
      if (!overlapsAny({ x, y, width: nw, height: nh }, existing)) {
        return { x, y };
      }
    }
  }
  return { x: baseX, y: baseY };
}
