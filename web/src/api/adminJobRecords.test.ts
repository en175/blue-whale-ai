import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./http', () => ({ apiRequest: http.apiRequest }));

import { fetchAdminJobRecords } from './adminJobRecords';

function urlOf(): string {
  return String(http.apiRequest.mock.calls[0]?.[0] ?? '');
}

describe('fetchAdminJobRecords 的查询串', () => {
  beforeEach(() => vi.clearAllMocks());

  it('★ 用户筛选发的是 keyword，**不是** userId', async () => {
    http.apiRequest.mockResolvedValue({ list: [], total: 0 });

    await fetchAdminJobRecords({ page: 1, pageSize: 20, keyword: '13800008888' });

    expect(urlOf()).toContain('keyword=13800008888');
    expect(urlOf()).not.toContain('userId=');
  });

  it('没给关键词时不带 keyword（空串 = 全部用户，不能变成一次筛选）', async () => {
    http.apiRequest.mockResolvedValue({ list: [], total: 0 });

    await fetchAdminJobRecords({ page: 1, pageSize: 20 });

    expect(urlOf()).not.toContain('keyword=');
  });
});
