import { beforeEach, describe, expect, it, vi } from 'vitest';

// 这一条钉的是**查询串本身**：页面测试整份 mock 掉了这个模块，所以 `qs.set('keyword', …)`
// 那行代码在别处一次都不会被执行到。谁把它改回 `userId`（或者删掉），页面测试仍然全绿 ——
// 而线上手机号 / 用户名搜索会静默退化成「只认数字」或「回一页全站流水」。

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./http', () => ({ apiRequest: http.apiRequest }));

import { fetchAdminConsumptionRecords } from './adminConsumptionRecords';

function urlOf(): string {
  return String(http.apiRequest.mock.calls[0]?.[0] ?? '');
}

describe('fetchAdminConsumptionRecords 的查询串', () => {
  // 每条用例只看自己那一次调用：不清掉的话 `calls[0]` 还是上一条的
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
