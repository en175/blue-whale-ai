import { beforeEach, describe, expect, it, vi } from 'vitest';

// 同 adminJobRecords.test.ts：页面测试整份 mock 掉了这个模块，查询串本身没人看着。
// 谁把 `qs.set('keyword', …)` 改回 `userId`，页面测试仍然全绿，而手机号 / 用户名搜索
// 会静默退化成「只认数字」。

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./http', () => ({ apiRequest: http.apiRequest }));

import { fetchAdminRechargeRecords } from './adminRechargeRecords';

function urlOf(): string {
  return String(http.apiRequest.mock.calls[0]?.[0] ?? '');
}

describe('fetchAdminRechargeRecords 的查询串', () => {
  // 每条用例只看自己那一次调用：不清掉的话 `calls[0]` 还是上一条的
  beforeEach(() => vi.clearAllMocks());

  it('★ 用户筛选发的是 keyword，**不是** userId', async () => {
    http.apiRequest.mockResolvedValue({ list: [], total: 0 });

    await fetchAdminRechargeRecords({ page: 1, pageSize: 20, keyword: '13800008888' });

    expect(urlOf()).toContain('keyword=13800008888');
    expect(urlOf()).not.toContain('userId=');
  });

  it('没给关键词时不带 keyword（空串 = 全部用户，不能变成一次筛选）', async () => {
    http.apiRequest.mockResolvedValue({ list: [], total: 0 });

    await fetchAdminRechargeRecords({ page: 1, pageSize: 20 });

    expect(urlOf()).not.toContain('keyword=');
  });
});
