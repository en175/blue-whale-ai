import { describe, expect, it } from 'vitest';
import {
  HOME_DURATION_MAX,
  HOME_DURATION_MIN,
  HOME_DURATION_STEP,
  clampDuration,
  parseDurationInput,
  ratioFromValue,
  snapDuration,
  springSettled,
  stepSpring,
  valueFromPointer,
  valueFromRatio,
} from './durationSliderModel';

describe('durationSliderModel', () => {
  it('keeps the homepage duration range at 4–15 with step 1', () => {
    expect(HOME_DURATION_MIN).toBe(4);
    expect(HOME_DURATION_MAX).toBe(15);
    expect(HOME_DURATION_STEP).toBe(1);
  });

  it('clamps finite values and falls back for NaN', () => {
    expect(clampDuration(3, 4, 15)).toBe(4);
    expect(clampDuration(20, 4, 15)).toBe(15);
    expect(clampDuration(10, 4, 15)).toBe(10);
    expect(clampDuration(Number.NaN, 4, 15)).toBe(4);
  });

  it('snaps to the configured step inside the range', () => {
    expect(snapDuration(7.4, 4, 15, 1)).toBe(7);
    expect(snapDuration(7.6, 4, 15, 1)).toBe(8);
    expect(snapDuration(1, 4, 15, 1)).toBe(4);
    expect(snapDuration(99, 4, 15, 1)).toBe(15);
  });

  it('maps pointer position on the track to a duration', () => {
    expect(valueFromPointer(0, 0, 100, 4, 15)).toBe(4);
    expect(valueFromPointer(100, 0, 100, 4, 15)).toBe(15);
    expect(valueFromPointer(50, 0, 100, 4, 15)).toBe(9.5);
    expect(valueFromPointer(-20, 0, 100, 4, 15)).toBe(4);
    expect(valueFromPointer(140, 0, 100, 4, 15)).toBe(15);
  });

  it('round-trips ratio and value at the endpoints', () => {
    expect(ratioFromValue(4, 4, 15)).toBe(0);
    expect(ratioFromValue(15, 4, 15)).toBe(1);
    expect(valueFromRatio(0, 4, 15)).toBe(4);
    expect(valueFromRatio(1, 4, 15)).toBe(15);
  });

  it('parses numeric input and rejects empty or non-numeric text', () => {
    expect(parseDurationInput('8', 4, 15, 1)).toBe(8);
    expect(parseDurationInput(' 14 ', 4, 15, 1)).toBe(14);
    expect(parseDurationInput('0', 4, 15, 1)).toBe(4);
    expect(parseDurationInput('40', 4, 15, 1)).toBe(15);
    expect(parseDurationInput('', 4, 15, 1)).toBeNull();
    expect(parseDurationInput('abc', 4, 15, 1)).toBeNull();
  });

  it('moves toward the target with decaying velocity (damped spring)', () => {
    let position = 0;
    let velocity = 0;
    for (let i = 0; i < 12; i += 1) {
      const next = stepSpring(position, velocity, 1, 1 / 60);
      position = next.position;
      velocity = next.velocity;
    }
    expect(position).toBeGreaterThan(0.2);
    expect(position).toBeLessThan(1);
    expect(Math.abs(velocity)).toBeGreaterThan(0);

    for (let i = 0; i < 240; i += 1) {
      const next = stepSpring(position, velocity, 1, 1 / 60);
      position = next.position;
      velocity = next.velocity;
    }
    expect(springSettled(position, velocity, 1)).toBe(true);
    expect(position).toBeCloseTo(1, 2);
  });
});
