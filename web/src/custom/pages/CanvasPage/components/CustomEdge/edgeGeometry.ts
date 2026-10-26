
export type Point = { x: number; y: number };

type Cubic = readonly [Point, Point, Point, Point];

const CUBIC_PATH = /^M(-?[\d.]+),(-?[\d.]+) C(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)$/;

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
    const point = cubicAt(curve, from.t + (to.t - from.t) * ratio);
    const distance = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestArc = from.arc + (to.arc - from.arc) * ratio;
    }
  }
  return nearestArc;
}

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

export function placeScissorsOnEdge(path: string, pointer: Point, gap: number): Point {
  const curve = parseCubic(path);
  if (!curve) return { ...pointer };

  const samples = sampleCubic(curve);
  const total = samples[samples.length - 1].arc;
  const projected = projectOnCurve(curve, samples, pointer);
  const before = projected;
  const after = total - projected;
  const forward = after >= before;
  const room = forward ? after : before;

  return room >= gap
    ? pointAtArc(curve, samples, forward ? projected + gap : projected - gap)
    : pointAtArc(curve, samples, forward ? total : 0);
}
