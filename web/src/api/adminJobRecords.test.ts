import { beforeEach, describe, expect, it, vi } from 'vitest';
// 这一条钉的是**查询串本身**：页面测试整份 mock 掉了这个模块，所以 `qs.set('keyword', …)`
// 那行代码在别处一次都不会被执行到。谁把它改回 `userId`，页面测试仍然全绿 ——
// 而线上手机号 / 用户名搜索会静默退化成「只认数字」，甚至（连兼容一并删掉时）
// 退化成回一页全站任务。这是这套改动唯一没人看着的一环。

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./http', () => ({ apiRequest: http.apiRequest }));

import { fetchAdminJobRecords } from './adminJobRecords';

function urlOf(): string {
  return String(http.apiRequest.mock.calls[0]?.[0] ?? '');
}

describe('fetchAdminJobRecords 的查询串', () => {
  // 每条用例只看自己那一次调用：不清掉的话 `calls[0]` 还是上一条的
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
