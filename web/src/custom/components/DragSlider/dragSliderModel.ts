export const SPRING_STIFFNESS = 110;
export const SPRING_DAMPING = 16;

export interface SliderScale {
  ratioFromValue: (value: number) => number;
  valueFromRatio: (ratio: number) => number;
  stepValue: (value: number) => number;
}

export function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function snapValue(value: number, min: number, max: number, step: number): number {
  const clamped = clampValue(value, min, max);
  if (!(step > 0)) return Math.round(clamped);
  const snapped = min + Math.round((clamped - min) / step) * step;
  return clampValue(Number(snapped.toFixed(6)), min, max);
}

export function ratioFromValue(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clampValue((value - min) / (max - min), 0, 1);
}

export function valueFromRatio(ratio: number, min: number, max: number): number {
  return min + clampValue(ratio, 0, 1) * (max - min);
}

export function valueFromPointer(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  min: number,
  max: number,
): number {
  if (!(trackWidth > 0)) return min;
  return valueFromRatio((clientX - trackLeft) / trackWidth, min, max);
}

export function stepSpring(
  position: number,
  velocity: number,
  target: number,
  dtSeconds: number,
  stiffness = SPRING_STIFFNESS,
  damping = SPRING_DAMPING,
): { position: number; velocity: number } {
  const dt = Math.min(Math.max(dtSeconds, 0), 0.032);
  if (dt === 0) return { position, velocity };
  const accel = -stiffness * (position - target) - damping * velocity;
  const nextVelocity = velocity + accel * dt;
  return { position: position + nextVelocity * dt, velocity: nextVelocity };
}

export function springSettled(position: number, velocity: number, target: number): boolean {
  return Math.abs(position - target) < 0.0008 && Math.abs(velocity) < 0.02;
}

export function clampPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}
