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

  // 匹配已下沉到服务端（`contains`，大小写由 MySQL 的 _ci 排序规则兜住）；
  // 这里归一成小写是为了让**查询键**稳定 —— 同一个意图不该因为大小写不同
  // 而变成缓存里的两个键、两次请求。
  it('大小写归一', () => {
    expect(normalizeAdminUserKeyword('Alice')).toBe('alice');
  });
});
