import { describe, expect, it } from 'vitest';
import { normalizeAdminUserKeyword } from './userSearch';

describe('normalizeAdminUserKeyword', () => {
  it.each([
    ['42', '42'],
    ['  42  ', '42'],
    ['#42', '42'],
    ['##42', '42'],
    ['#', ''],
    ['', ''],
  ] as const)('%j → %s', (input, expected) => {
    expect(normalizeAdminUserKeyword(input)).toBe(expected);
  });

  it('大小写归一', () => {
    expect(normalizeAdminUserKeyword('Alice')).toBe('alice');
  });
});
