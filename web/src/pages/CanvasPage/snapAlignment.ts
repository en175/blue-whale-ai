/* ============================================
 * snapAlignment 画布拖拽对齐吸附（IKGGCT T1，纯函数）：
 * 拖动卡片时按屏幕像素阈值（默认 8px；画布坐标阈值 = 屏幕阈值 / zoom）
 * 与参考块做六种对齐：垂直中线（dx）、水平中线（dy）、左/右边缘（dx）、
 * 上/下边缘（dy）。参考块 = 未被拖动的卡 + 组框伪节点（type 'groupFrame'）
 * 的整体矩形；视口边缘不参与。双轴独立：x / y 各自取「屏幕距离 =
 * 画布距离 × zoom」最近者命中，可同时修正。对齐线仅在命中时给出：
 * 轴向（水平/垂直线）+ 画布坐标线段区间；区间 = 主拖卡与参考块在正交
 * 方向上的重叠区间，两端各外延 guideExtension（默认 16 画布像素，
 * 不横贯整个画布）；正交方向无重叠时退化为以间隙中点为中心、
 * 长 2 × 外延量的最短线段。零 React / React Flow 运行时依赖、零副作用。
 * ============================================ */

/** 画布坐标系矩形（flow 坐标，左上角 + 宽高） */
export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 对齐参考块：矩形 + 来源节点 id（对齐线归属与测试断言用） */
export interface SnapTarget {
  id: string;
  rect: SnapRect;
}

/** x 向对齐关系（产生 dx 修正）：垂直中线对垂直中线 / 左边缘贴左边缘 / 右边缘贴右边缘 */
export type SnapXRelation = 'centerX' | 'left' | 'right';

/** y 向对齐关系（产生 dy 修正）：水平中线对水平中线 / 上边缘贴上边缘 / 下边缘贴下边缘 */
export type SnapYRelation = 'centerY' | 'top' | 'bottom';

/** 六种对齐关系 */
export type SnapRelation = SnapXRelation | SnapYRelation;

/** 对齐线描述（仅吸附命中时产生） */
export interface SnapGuide {
  /** 线轴向：垂直线沿 y 延伸（x 向对齐产生）/ 水平线沿 x 延伸（y 向对齐产生） */
  orientation: 'horizontal' | 'vertical';
  /** 线所在的固定坐标（画布坐标）：水平线为 y，垂直线为 x */
  pos: number;
  /** 线段区间起点（画布坐标，沿线方向）：水平线为 x，垂直线为 y */
  from: number;
  /** 线段区间终点（画布坐标，沿线方向，恒 ≥ from） */
  to: number;
  /** 命中的参考块 id */
  targetId: string;
  /** 命中的对齐关系 */
  relation: SnapRelation;
}

/** 对齐计算结果：双轴位置修正量（主拖卡被拉向参考块）+ 命中的对齐线列表 */
export interface SnapAlignmentResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface ComputeSnapAlignmentOptions {
  /** 触发阈值（屏幕像素），默认 SNAP_THRESHOLD_PX */
  thresholdPx?: number;
  /** 当前缩放（画布坐标阈值 = thresholdPx / zoom），默认 1 */
  zoom?: number;
  /** 对齐线两端外延量（画布像素），默认 SNAP_GUIDE_EXTENSION */
  guideExtension?: number;
}

/** 默认触发阈值：8 屏幕像素 */
export const SNAP_THRESHOLD_PX = 8;

/** 对齐线默认两端外延量：16 画布像素——线段略长出两块，视觉可辨且不横贯画布 */
export const SNAP_GUIDE_EXTENSION = 16;

/** 单轴命中的候选：修正量（正 = 主拖卡向正方向被拉向参考块）+ 命中关系与参考块 */
interface AxisHit {
  delta: number;
  relation: SnapRelation;
  target: SnapTarget;
}

/** x 向命中线的固定 x 坐标（吸附后主拖卡与参考块共享的那条竖线位置） */
function guidePosX(hit: AxisHit): number {
  const r = hit.target.rect;
  if (hit.relation === 'centerX') return r.x + r.width / 2;
  if (hit.relation === 'left') return r.x;
  return r.x + r.width;
}

/** y 向命中线的固定 y 坐标（吸附后主拖卡与参考块共享的那条横线位置） */
function guidePosY(hit: AxisHit): number {
  const r = hit.target.rect;
  if (hit.relation === 'centerY') return r.y + r.height / 2;
  if (hit.relation === 'top') return r.y;
  return r.y + r.height;
}

/** 线段区间 = 两区间 [aMin,aMax] 与 [bMin,bMax] 的重叠部分两端各外延 extension；
 *  正交方向无重叠时退化为以间隙中点为中心、长 2 × extension 的最短线段——
 *  命中仍能看到一段线，且不横贯整个画布（端点恰好相触时重叠区间长度 0，
 *  走重叠分支同样得到长 2 × extension 的线段，与退化分支一致）。 */
function guideRange(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
  extension: number,
): { from: number; to: number } {
  const overlapMin = Math.max(aMin, bMin);
  const overlapMax = Math.min(aMax, bMax);
  if (overlapMax >= overlapMin) {
    return { from: overlapMin - extension, to: overlapMax + extension };
  }
  // 无重叠：overlapMin 是右者的左端、overlapMax 是左者的右端，取间隙中点
  const gapMid = (overlapMin + overlapMax) / 2;
  return { from: gapMid - extension, to: gapMid + extension };
}

/** 对齐吸附核心计算。
 *  逐轴（x、y 独立）在全部参考块 × 各自三种关系里取屏幕距离最近者命中；
 *  屏幕距离 ≤ thresholdPx（含等于）才吸附，修正量方向恒为把主拖卡拉向参考块。
 *  屏幕距离恰为 0（已对齐）同样命中——沿线拖动时持续显示对齐线。
 *  同距离并列时取遍历顺序在前者（targets 顺序 × centerX/left/right、centerY/top/bottom），
 *  保证结果确定。无命中时返回零修正与空对齐线。 */
export function computeSnapAlignment(
  dragging: SnapRect,
  targets: SnapTarget[],
  options: ComputeSnapAlignmentOptions = {},
): SnapAlignmentResult {
  const thresholdPx = options.thresholdPx ?? SNAP_THRESHOLD_PX;
  const zoom = options.zoom ?? 1;
  const guideExtension = options.guideExtension ?? SNAP_GUIDE_EXTENSION;
  // 屏幕阈值换算到画布坐标；zoom 为全体候选共享常量，比较 |delta| 即比较屏幕距离
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
    // x 向对齐产生垂直线：pos 为共享竖线的 x，线段沿 y 取两块 y 投影重叠区间
    const { from, to } = guideRange(
      dragging.y,
      dragging.y + dragging.height,
      bestX.target.rect.y,
      bestX.target.rect.y + bestX.target.rect.height,
      guideExtension,
    );
    guides.push({ orientation: 'vertical', pos: guidePosX(bestX), from, to, targetId: bestX.target.id, relation: bestX.relation });
  }
  if (bestY != null) {
    // y 向对齐产生水平线：pos 为共享横线的 y，线段沿 x 取两块 x 投影重叠区间
    const { from, to } = guideRange(
      dragging.x,
      dragging.x + dragging.width,
      bestY.target.rect.x,
      bestY.target.rect.x + bestY.target.rect.width,
      guideExtension,
    );
    guides.push({ orientation: 'horizontal', pos: guidePosY(bestY), from, to, targetId: bestY.target.id, relation: bestY.relation });
  }
  return { dx: bestX?.delta ?? 0, dy: bestY?.delta ?? 0, guides };
}

/** React Flow 节点的结构化最小形状（本地接口，避免引入组件运行时依赖）：
 *  宽高优先取 measured，缺省回退节点自身 width / height 字段 */
export interface SnapNodeLike {
  id: string;
  type?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
}

/** 解析节点尺寸：measured 优先，缺省回退节点自身 width / height 字段；
 *  均缺失（尺寸未知无法对齐）或节点本身不存在时返回 null。 */
export function resolveNodeSize(
  node: SnapNodeLike | null | undefined,
): { width: number; height: number } | null {
  const width = node?.measured?.width ?? node?.width;
  const height = node?.measured?.height ?? node?.height;
  if (width == null || height == null) return null;
  return { width, height };
}

/** 收集对齐参考块：排除被拖集合（一起拖动的多张卡互不为参考）；
 *  type 'groupFrame' 的组框伪节点按其整体矩形作为一个参考块；
 *  measured 与 width / height 均缺失的节点跳过（尺寸未知无法对齐）。 */
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
