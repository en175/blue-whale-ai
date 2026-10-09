
export interface SpawnBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DraftSpawnOptions {
  center: { x: number; y: number };
  dockTop: number;
  nodes: SpawnBox[];
  random?: () => number;
}

export const DRAFT_NODE_SIZE = { width: 320, height: 340 } as const;
const GAP = 8;
const DOCK_CLEARANCE = 24;
const JITTER = 48;
const MAX_STEP = 3;

export function overlaps(a: SpawnBox, b: SpawnBox): boolean {
  return (
    a.x < b.x + b.width + GAP &&
    a.x + a.width + GAP > b.x &&
    a.y < b.y + b.height + GAP &&
    a.y + a.height + GAP > b.y
  );
}

function boxAt(cx: number, cy: number, dockTop: number): SpawnBox {
  const x = cx - DRAFT_NODE_SIZE.width / 2;
  let y = cy - DRAFT_NODE_SIZE.height / 2;
  const maxY = dockTop - DOCK_CLEARANCE - DRAFT_NODE_SIZE.height;
  if (y > maxY) y = maxY;
  return { x, y, width: DRAFT_NODE_SIZE.width, height: DRAFT_NODE_SIZE.height };
}

export function nextDraftPosition(options: DraftSpawnOptions): { x: number; y: number } {
  const { center, dockTop, nodes } = options;
  const random = options.random ?? Math.random;

  const jitterX = (random() * 2 - 1) * JITTER;
  const jitterY = (random() * 2 - 1) * JITTER;
  const cx = center.x + jitterX;
  const cy = center.y + jitterY;

  const stepX = DRAFT_NODE_SIZE.width + GAP + 32;
  const stepY = DRAFT_NODE_SIZE.height + GAP + 32;
  const fallback = boxAt(cx, cy, dockTop);

  for (let ring = 0; ring <= MAX_STEP; ring += 1) {
    const offsets: Array<[number, number]> =
      ring === 0
        ? [[0, 0]]
        : [
            [ring, 0],
            [0, ring],
            [-ring, 0],
            [0, -ring],
            [ring, ring],
            [-ring, ring],
            [ring, -ring],
            [-ring, -ring],
          ];
    for (const [ox, oy] of offsets) {
      const candidate = boxAt(cx + ox * stepX, cy + oy * stepY, dockTop);
      if (!nodes.some((n) => overlaps(candidate, n))) {
        return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
      }
    }
  }
  return { x: Math.round(fallback.x), y: Math.round(fallback.y) };
}
