/**
 * placement —— 占位节点落点算法（design D2），纯函数无 DOM/视口依赖。
 *
 * 视口中心锚 + 行优先网格不重叠搜索：占位节点落在用户正看区域中心，多张沿行整齐排
 * （中心→右→换行），绝不与已有节点矩形相交（不可覆盖硬约束）。
 *
 * 从 blue_whale_web/app/canvas/_canvas/placement.ts 抽出，供后端 Canvas 第二阶段放置复用
 * （IK67H9 / T11）。前端 placement.ts 改为 re-export 本模块。
 */

export type Rect = { x: number; y: number; width: number; height: number };

export type FindPlacementOptions = {
  /** 已有节点矩形（ready + 本批已放占位），落点不可与之相交。 */
  existing: Rect[];
  /** 视口中心世界坐标（用户正看的区域中心）。 */
  anchor: { x: number; y: number };
  /** 候选节点宽，默认 200。 */
  nodeWidth?: number;
  /** 候选节点高，默认 200。 */
  nodeHeight?: number;
  /** 节点间距，默认 24。 */
  gap?: number;
  /** 一行最多容纳节点数（行满换行），默认 3。 */
  maxPerRow?: number;
};

export const DEFAULT_NODE_WIDTH = 200;
export const DEFAULT_NODE_HEIGHT = 200;
export const DEFAULT_GAP = 24;
export const DEFAULT_MAX_PER_ROW = 3;
/** Approved SceneCard Spec 固定宽度；生产渲染器接入前使用原型的兼容高度。 */
export const SCENE_CARD_WIDTH = 400;
export const SCENE_CARD_FALLBACK_HEIGHT = 1080;
/** 行搜索上限，防无限循环；穷尽后回起点格（允许重叠优于无落点）。 */
const SEARCH_ROWS = 50;

/** AABB 相交检测（边界相切视为不重叠）。 */
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

/**
 * 行优先网格搜索：起点格对齐视口中心（节点中心≈anchor），同行向右，行满换下行。
 * 返回第一个不与 existing 相交的格左上角坐标。网格步长按候选节点宽/高分别计算。
 */
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

  // 起点格：让节点中心尽量对齐 anchor，再对齐到网格使多张整齐成组
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
  // 兜底：existing 极密搜索穷尽，回起点格（有落点优于无落点）
  return { x: baseX, y: baseY };
}
