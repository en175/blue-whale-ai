import { beforeEach, describe, expect, it, vi } from 'vitest';


const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./http', () => ({ apiRequest: http.apiRequest }));

import { fetchAdminConsumptionRecords } from './adminConsumptionRecords';

function urlOf(): string {
  return String(http.apiRequest.mock.calls[0]?.[0] ?? '');
}

describe('fetchAdminConsumptionRecords 的查询串', () => {
  beforeEach(() => vi.clearAllMocks());

  it('★ 用户筛选发的是 keyword，**不是** userId', async () => {
    http.apiRequest.mockResolvedValue({ items: [], total: 0 });

    await fetchAdminConsumptionRecords({
      pageSize: 20,
      page: 1,
      keyword: '13800008888',
    });

    expect(urlOf()).toContain('keyword=13800008888');
    expect(urlOf()).not.toContain('userId=');
  });

  it('没给关键词时不带 keyword（空串 = 全站，不能变成一次筛选）', async () => {
    http.apiRequest.mockResolvedValue({ items: [], total: 0 });

    await fetchAdminConsumptionRecords({ pageSize: 20, page: 1 });

    expect(urlOf()).not.toContain('keyword=');
  });
});
