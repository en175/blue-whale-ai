/* ============================================
 * 连线几何（纯函数）：把指针位置投到连线上，再沿连线错开固定距离定出剪刀圆心
 * 只用画布坐标做贝塞尔求值，不依赖浏览器的 SVG 测量接口，jsdom 下可直接测试
 * ============================================ */

export type Point = { x: number; y: number };

/** 三次贝塞尔的四个控制点 */
type Cubic = readonly [Point, Point, Point, Point];

/** getBezierPath 固定产出 "M sx,sy C c1x,c1y c2x,c2y tx,ty"（库内模板字符串，无其它分支） */
const CUBIC_PATH = /^M(-?[\d.]+),(-?[\d.]+) C(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)$/;

/** 采样段数：折线只用来定弧长，落点最终都由贝塞尔求值给出，段数不必很大 */
const SEGMENTS = 64;

type Sample = Point & { t: number; arc: number };

function parseCubic(path: string): Cubic | null {
  const matched = CUBIC_PATH.exec(path.trim());
  if (!matched) return null;
  const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = matched.slice(1).map(Number);
  return [
    { x: x0, y: y0 },
    { x: c1x, y: c1y },
    { x: c2x, y: c2y },
    { x: x1, y: y1 },
  ];
}

/** 三次贝塞尔在参数 t 处的点 */
function cubicAt([p0, c1, c2, p3]: Cubic, t: number): Point {
  const rest = 1 - t;
  const a = rest * rest * rest;
  const b = 3 * rest * rest * t;
  const c = 3 * rest * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  };
}

/** 沿曲线等参数采样：每点的参数与从起点累计的弧长（画布坐标） */
function sampleCubic(curve: Cubic): Sample[] {
  const samples: Sample[] = [{ ...curve[0], t: 0, arc: 0 }];
  for (let index = 1; index <= SEGMENTS; index += 1) {
    const t = index / SEGMENTS;
    const point = cubicAt(curve, t);
    const previous = samples[index - 1];
    samples.push({
      ...point,
      t,
      arc: previous.arc + Math.hypot(point.x - previous.x, point.y - previous.y),
    });
  }
  return samples;
}

/**
 * 指针位置在连线上的投影（返回累计弧长）：
 * 先取最近的采样点，再在它相邻的两段上做一次垂足投影，避免错开量在高缩放下失真
 */
function projectOnCurve(curve: Cubic, samples: Sample[], target: Point): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  samples.forEach((sample, index) => {
    const distance = (sample.x - target.x) ** 2 + (sample.y - target.y) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  let nearestArc = samples[nearestIndex].arc;
  for (const start of [nearestIndex - 1, nearestIndex]) {
    const from = samples[start];
    const to = samples[start + 1];
    if (!from || !to) continue;
    const span = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
    if (span === 0) continue;
    const raw = ((target.x - from.x) * (to.x - from.x) + (target.y - from.y) * (to.y - from.y)) / span;
    const ratio = Math.min(1, Math.max(0, raw));
    // 弧长按段内线性插值取，落点用参数求值取，保证圆心精确落在连线上
    const point = cubicAt(curve, from.t + (to.t - from.t) * ratio);
    const distance = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestArc = from.arc + (to.arc - from.arc) * ratio;
    }
  }
  return nearestArc;
}

/** 连线上累计弧长 arc 处的点：参数由采样表定位，点由贝塞尔求值给出 */
function pointAtArc(curve: Cubic, samples: Sample[], arc: number): Point {
  const last = samples[samples.length - 1];
  const clamped = Math.min(last.arc, Math.max(0, arc));
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1];
    const to = samples[index];
    if (clamped > to.arc) continue;
    const span = to.arc - from.arc;
    const ratio = span === 0 ? 0 : (clamped - from.arc) / span;
    return cubicAt(curve, from.t + (to.t - from.t) * ratio);
  }
  return { x: last.x, y: last.y };
}

/**
 * 剪刀圆心的落点：先把指针位置投到连线上，再沿连线朝剩余弧长更长的一侧错开 gap（画布坐标）。
 * 那一侧不够长（连线比错开量还短）就贴着那一端——任何情况下圆心都在连线上，
 * 指针沿连线走向剪刀的整条路都不会脱离连线命中范围。
 * 路径串解析不了时退回指针位置，按钮仍在可见连线附近，不至于消失。
 */
export function placeScissorsOnEdge(path: string, pointer: Point, gap: number): Point {
  const curve = parseCubic(path);
  if (!curve) return { ...pointer };

  const samples = sampleCubic(curve);
  const total = samples[samples.length - 1].arc;
  const projected = projectOnCurve(curve, samples, pointer);
  const before = projected;
  const after = total - projected;
  // 朝剩余更长的一侧走：这一侧是两侧里更长的，它都放不下时两侧都不够，只能贴端点
  const forward = after >= before;
  const room = forward ? after : before;

  return room >= gap
    ? pointAtArc(curve, samples, forward ? projected + gap : projected - gap)
    : pointAtArc(curve, samples, forward ? total : 0);
}
