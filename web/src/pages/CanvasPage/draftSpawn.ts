/* ============================================
 * 生成草稿出生点（IKDMQQ）：视口中心附近找空位，
 * 纵向避开底部 Dock 预留区，并与既有节点占位盒去重叠
 * ============================================ */

/** 占位盒（flow 坐标，左上角原点） */
export interface SpawnBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DraftSpawnOptions {
  /** 视口中心（flow 坐标） */
  center: { x: number; y: number };
  /** Dock 预留区上沿（flow 坐标）；无避让需求传 Number.POSITIVE_INFINITY */
  dockTop: number;
  /** 既有节点占位盒（flow 坐标） */
  nodes: SpawnBox[];
  /** 随机源（测试注入确定性） */
  random?: () => number;
}

/** 新节点估算尺寸：内容区 280 + 边框/标题余量 */
export const DRAFT_NODE_SIZE = { width: 320, height: 340 } as const;
/** 盒与盒之间的最小间距 */
const GAP = 8;
/** 盒底与 Dock 上沿之间的最小间距 */
const DOCK_CLEARANCE = 24;
/** 中心随机抖动幅度（±px） */
const JITTER = 48;
/** 去重叠候选步进倍数上限（横/纵各扫这么多步，穷尽后回退中心） */
const MAX_STEP = 3;

/** 两盒是否相交（含 GAP 间距） */
export function overlaps(a: SpawnBox, b: SpawnBox): boolean {
  return (
    a.x < b.x + b.width + GAP &&
    a.x + a.width + GAP > b.x &&
    a.y < b.y + b.height + GAP &&
    a.y + a.height + GAP > b.y
  );
}

/** 候选中心点 → 盒（左上角），盒底越过 dockTop - DOCK_CLEARANCE 时整体上移 */
function boxAt(cx: number, cy: number, dockTop: number): SpawnBox {
  const x = cx - DRAFT_NODE_SIZE.width / 2;
  let y = cy - DRAFT_NODE_SIZE.height / 2;
  const maxY = dockTop - DOCK_CLEARANCE - DRAFT_NODE_SIZE.height;
  if (y > maxY) y = maxY;
  return { x, y, width: DRAFT_NODE_SIZE.width, height: DRAFT_NODE_SIZE.height };
}

/**
 * 计算新草稿节点的出生位置（React Flow position，左上角）。
 * 候选顺序：中心（含抖动）→ 向右/下/左/上逐格外扩；全部相交时回退 Dock 避让后的中心位。
 */
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
    // 方形环上的候选偏移（ring=0 即中心）；顺序：右 → 下 → 左 → 上 → 四角
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
