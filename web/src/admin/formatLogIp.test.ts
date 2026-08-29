import { describe, expect, it } from 'vitest';
import { formatLogIp } from './formatLogIp';

describe('formatLogIp', () => {
  it.each([
    ['203.0.113.10', '203.0.113.10'],
    ['  10.0.0.1  ', '10.0.0.1'],
    ['', '—'],
    ['   ', '—'],
    [null, '—'],
    [undefined, '—'],
  ] as const)('ip=%j → %s', (ip, expected) => {
    expect(formatLogIp(ip)).toBe(expected);
  });
});
