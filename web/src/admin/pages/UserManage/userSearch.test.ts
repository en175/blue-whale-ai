import { describe, expect, it } from 'vitest';
import { matchesAdminUserKeyword, normalizeAdminUserKeyword } from './userSearch';

const user = {
  userId: 42,
  nickname: 'Alice',
  phone: '13800138000',
};

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
});

describe('matchesAdminUserKeyword', () => {
  it('纯数字用户 ID 能命中', () => {
    expect(matchesAdminUserKeyword(user, '42')).toBe(true);
  });

  it('带前导 # 的用户 ID 也能命中，避免列表曾展示 #N 时搜不到', () => {
    expect(matchesAdminUserKeyword(user, '#42')).toBe(true);
  });

  it('不匹配其他用户 ID', () => {
    expect(matchesAdminUserKeyword(user, '41')).toBe(false);
    expect(matchesAdminUserKeyword(user, '#41')).toBe(false);
  });

  it('仍可按昵称和手机号筛选', () => {
    expect(matchesAdminUserKeyword(user, 'ali')).toBe(true);
    expect(matchesAdminUserKeyword(user, '1380013')).toBe(true);
    expect(matchesAdminUserKeyword(user, 'bob')).toBe(false);
  });
});
