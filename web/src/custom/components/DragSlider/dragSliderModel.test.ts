import { describe, expect, it } from 'vitest';
import {
  clampValue,
  ratioFromValue,
  snapValue,
  springSettled,
  stepSpring,
  valueFromPointer,
  valueFromRatio,
} from './dragSliderModel';

describe('dragSliderModel', () => {
  it('clamps finite values and falls back for NaN', () => {
    expect(clampValue(3, 4, 15)).toBe(4);
    expect(clampValue(20, 4, 15)).toBe(15);
    expect(clampValue(10, 4, 15)).toBe(10);
    expect(clampValue(Number.NaN, 4, 15)).toBe(4);
  });

  it('snaps to the configured step inside the range', () => {
    expect(snapValue(7.4, 4, 15, 1)).toBe(7);
    expect(snapValue(7.6, 4, 15, 1)).toBe(8);
    expect(snapValue(1, 4, 15, 1)).toBe(4);
    expect(snapValue(99, 4, 15, 1)).toBe(15);
  });

  it('maps pointer position on the track to a value', () => {
    expect(valueFromPointer(0, 0, 100, 4, 15)).toBe(4);
    expect(valueFromPointer(100, 0, 100, 4, 15)).toBe(15);
    expect(valueFromPointer(50, 0, 100, 4, 15)).toBe(9.5);
  });

  it('round-trips ratio and value at the endpoints', () => {
    expect(ratioFromValue(4, 4, 15)).toBe(0);
    expect(ratioFromValue(15, 4, 15)).toBe(1);
    expect(valueFromRatio(0, 4, 15)).toBe(4);
    expect(valueFromRatio(1, 4, 15)).toBe(15);
  });

  it('moves toward the target with decaying velocity', () => {
    let position = 0;
    let velocity = 0;
    for (let i = 0; i < 12; i += 1) {
      const next = stepSpring(position, velocity, 1, 1 / 60);
      position = next.position;
      velocity = next.velocity;
    }
    expect(position).toBeGreaterThan(0.2);
    expect(position).toBeLessThan(1);

    for (let i = 0; i < 240; i += 1) {
      const next = stepSpring(position, velocity, 1, 1 / 60);
      position = next.position;
      velocity = next.velocity;
    }
    expect(springSettled(position, velocity, 1)).toBe(true);
    expect(position).toBeCloseTo(1, 2);
  });
});
