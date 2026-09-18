/* ============================================
 * 连线几何纯函数：指针投影 + 沿连线错开定剪刀圆心
 * 断言只落在几何结果上（圆心是否在连线上、错开多远、朝哪一侧），不读内部采样表
 * ============================================ */
import { describe, expect, it } from 'vitest';
import { placeScissorsOnEdge, type Point } from './edgeGeometry';

type Cubic = [Point, Point, Point, Point];

/** 与组件同形的两条连线：S 形曲线（左右手柄）与一条 20 单位长的直线 */
const S_CURVE: Cubic = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 50, y: 100 },
  { x: 100, y: 100 },
];
const SHORT_LINE: Cubic = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 0 },
  { x: 20, y: 0 },
];

/** 按 getBezierPath 的模板拼路径串：解析出问题会直接表现为圆心不在线上 */
function asPath([p0, c1, c2, p3]: Cubic): string {
  return `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p3.x},${p3.y}`;
}

function at([p0, c1, c2, p3]: Cubic, t: number): Point {
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

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const span = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  if (span === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const raw = ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / span;
  const ratio = Math.min(1, Math.max(0, raw));
  return Math.hypot(point.x - (from.x + (to.x - from.x) * ratio), point.y - (from.y + (to.y - from.y) * ratio));
}

/** 点到连线的最近距离：用折线逼近曲线，段数足够密，容差 0.05 画布单位 */
function distanceToCurve(curve: Cubic, point: Point): number {
  const segments = 200;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < segments; index += 1) {
    nearest = Math.min(
      nearest,
      distanceToSegment(point, at(curve, index / segments), at(curve, (index + 1) / segments)),
    );
  }
  return nearest;
}

const distance = (from: Point, to: Point) => Math.hypot(from.x - to.x, from.y - to.y);

describe('placeScissorsOnEdge 剪刀圆心落点', () => {
  it('圆心落在连线上：指针在线上、线外、超出两端都成立', () => {
    const pointers: Point[] = [
      { x: 50, y: 50 },
      { x: 50, y: 20 },
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 120, y: 60 },
    ];

    for (const pointer of pointers) {
      const center = placeScissorsOnEdge(asPath(S_CURVE), pointer, 30);
      expect(distanceToCurve(S_CURVE, center)).toBeLessThan(0.05);
    }
  });

  it('错开量就是传入的 gap：指针在线上时沿连线走出这么远', () => {
    const pointer = at(S_CURVE, 0.5);
    const center = placeScissorsOnEdge(asPath(S_CURVE), pointer, 30);

    // 弧长 ≥ 弦长：实测距离落在 [gap - 1, gap] 之间
    expect(distance(pointer, center)).toBeGreaterThan(29);
    expect(distance(pointer, center)).toBeLessThanOrEqual(30);
  });

  it('朝剩余更长的一侧错开：靠近起点朝终点走，靠近终点朝起点走', () => {
    const forward = placeScissorsOnEdge(asPath(S_CURVE), { x: 0, y: 0 }, 30);
    expect(distance({ x: 0, y: 0 }, forward)).toBeGreaterThan(29);
    expect(forward.x).toBeGreaterThan(0);

    const backward = placeScissorsOnEdge(asPath(S_CURVE), { x: 100, y: 100 }, 30);
    expect(distance({ x: 100, y: 100 }, backward)).toBeGreaterThan(29);
    expect(backward.x).toBeLessThan(100);
  });

  it('连线比错开量还短：贴到更长的那一端，仍落在连线上', () => {
    // 20 单位长的连线，两侧剩余各 10、都不够 30
    const toEnd = placeScissorsOnEdge(asPath(SHORT_LINE), { x: 10, y: 0 }, 30);
    expect(distance(toEnd, { x: 20, y: 0 })).toBeLessThan(0.05);
    expect(distanceToCurve(SHORT_LINE, toEnd)).toBeLessThan(0.05);

    // 指针偏后段：更长的一侧是起点那一端
    const toStart = placeScissorsOnEdge(asPath(SHORT_LINE), { x: 15, y: 0 }, 30);
    expect(distance(toStart, { x: 0, y: 0 })).toBeLessThan(0.05);
  });

  it('两端重合的零长连线：返回该点，不产生 NaN', () => {
    const center = placeScissorsOnEdge('M0,0 C0,0 0,0 0,0', { x: 3, y: 4 }, 30);
    expect(center).toEqual({ x: 0, y: 0 });
  });

  it('路径串不是库产出的贝塞尔形态：退回指针位置', () => {
    const pointer = { x: 1, y: 2 };
    expect(placeScissorsOnEdge('M0,0 L10,10', pointer, 30)).toEqual(pointer);
  });
});
