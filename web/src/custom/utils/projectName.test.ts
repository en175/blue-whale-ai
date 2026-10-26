import { describe, expect, it } from 'vitest';
import { defaultProjectName } from './projectName';

describe('defaultProjectName', () => {
  it('uses the supplied local date and time down to the minute', () => {
    expect(defaultProjectName(new Date(2026, 8, 7, 9, 5))).toBe('2026-09-07 09:05');
  });
});
