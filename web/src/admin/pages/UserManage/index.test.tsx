// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserManage from './index';

const adminApi = vi.hoisted(() => ({
  fetchAdminUsers: vi.fn(),
  manageAdminUser: vi.fn(),
  fetchOperationLogs: vi.fn(),
}));

vi.mock('@/api/adminUsers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminUsers')>();
  return {
    ...actual,
    ...adminApi,
    adminUsersOptions: (params: Parameters<typeof actual.fetchAdminUsers>[0]) => ({
      queryKey: actual.adminUserKeys.list(params),
      queryFn: () => adminApi.fetchAdminUsers(params),
    }),
  };
});

vi.mock('@/api/adminOperationLogs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminOperationLogs')>();
  return {
    ...actual,
    operationLogsOptions: (params: Parameters<typeof actual.fetchOperationLogs>[0]) => ({
      queryKey: actual.operationLogKeys.list(params),
      queryFn: () => Promise.resolve([]),
    }),
  };
});

let root: Root;
let mountNode: HTMLDivElement;

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        {
          client: new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          }),
        },
        createElement(UserManage),
      ),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  adminApi.fetchAdminUsers.mockResolvedValue({
    list: [
      {
        userId: 42,
        nickname: 'Alice',
        phone: '13800138000',
        balance: 100,
        totalRecharge: 200,
        totalSpend: 50,
        role: 1,
        status: 'active',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    total: 1,
  });
  adminApi.fetchOperationLogs.mockResolvedValue([]);
  adminApi.manageAdminUser.mockResolvedValue({ credits: 10, duplicated: false });
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('UserManage 用户 ID 展示', () => {
  it('列表用户 ID 与接口字段一致，不带 # 前缀', async () => {
    await renderPage();
    const row = [...document.body.querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent?.includes('Alice'),
    );
    expect(row?.querySelector('td')?.textContent).toBe('42');
  });

  it('详情里的用户 ID 同样不带 #', async () => {
    await renderPage();
    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find((b) => b.textContent === 'Alice')
        ?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const idLabel = [...document.body.querySelectorAll('span')].find(
      (el) => el.textContent === '用户ID',
    );
    expect(idLabel?.parentElement?.parentElement?.textContent).toBe('用户ID42');
  });
});

describe('UserManage 发放积分', () => {
  async function openGrantModal() {
    await renderPage();
    await clickGrantButton();
  }

  async function clickGrantButton() {
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="发放积分 Alice"]')?.click();
    });
    await settle();
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function fill(placeholder: string, value: string) {
    const input = [...document.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.placeholder === placeholder,
    );
    if (!input) throw new Error(`没有找到输入框：${placeholder}`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function confirmButton(): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === '确认发放',
    );
    if (!found) throw new Error('没有找到「确认发放」按钮');
    return found;
  }

  it('发放成功：正整数 + 一次意图一把幂等键', async () => {
    await openGrantModal();
    await fill('请输入积分数量', '10');
    await fill('请输入原因（必填）', '补偿');
    await act(async () => confirmButton().click());

    expect(adminApi.manageAdminUser).toHaveBeenCalledWith(42, {
      action: 'adjustBalance',
      reason: '补偿',
      value: 10,
      idempotencyKey: expect.any(String),
    });
    const key = adminApi.manageAdminUser.mock.calls[0]?.[1]?.idempotencyKey;
    expect(typeof key).toBe('string');
    expect((key as string).length).toBeGreaterThan(0);
  });

  it('发放失败后重试复用**同一把**幂等键（否则超时重发就是两笔）', async () => {
    adminApi.manageAdminUser.mockRejectedValueOnce(new Error('network down'));
    await openGrantModal();
    await fill('请输入积分数量', '10');
    await fill('请输入原因（必填）', '补偿');

    await act(async () => confirmButton().click());
    await settle();
    await act(async () => confirmButton().click());

    expect(adminApi.manageAdminUser).toHaveBeenCalledTimes(2);
    const first = adminApi.manageAdminUser.mock.calls[0]?.[1]?.idempotencyKey;
    const second = adminApi.manageAdminUser.mock.calls[1]?.[1]?.idempotencyKey;
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('关掉再开是一次**新意图**：换一把新钥匙（否则第二笔会被当成重试吞掉）', async () => {
    await openGrantModal();
    await fill('请输入积分数量', '10');
    await fill('请输入原因（必填）', '补偿');
    await act(async () => confirmButton().click());

    await clickGrantButton();
    await fill('请输入积分数量', '20');
    await fill('请输入原因（必填）', '再发一笔');
    await act(async () => confirmButton().click());

    expect(adminApi.manageAdminUser).toHaveBeenCalledTimes(2);
    const first = adminApi.manageAdminUser.mock.calls[0]?.[1]?.idempotencyKey;
    const second = adminApi.manageAdminUser.mock.calls[1]?.[1]?.idempotencyKey;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('0 / 负数 / 小数 / 超出安全整数范围都是非法值：按钮禁用，一笔都不提交', async () => {
    for (const bad of ['0', '-5', '1.5', '1e21']) {
      if (root) await act(async () => root.unmount());
      mountNode?.remove();
      vi.clearAllMocks();
      adminApi.fetchAdminUsers.mockResolvedValue({
        list: [
          {
            userId: 42,
            nickname: 'Alice',
            phone: '',
            balance: 100,
            totalRecharge: 0,
            totalSpend: 0,
            role: 1,
            status: 'active',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
        total: 1,
      });
      adminApi.fetchOperationLogs.mockResolvedValue([]);
      adminApi.manageAdminUser.mockResolvedValue({ credits: 10, duplicated: false });

      await openGrantModal();
      await fill('请输入积分数量', bad);
      await fill('请输入原因（必填）', '补偿');

      expect(confirmButton().disabled).toBe(true);
      await act(async () => confirmButton().click());
      expect(adminApi.manageAdminUser).not.toHaveBeenCalled();
    }
  });
});

describe('UserManage 服务端筛选与分页', () => {
  const KEYWORD_PLACEHOLDER = '搜索昵称/手机号/用户ID...';

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function clickButton(text: string) {
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.trim() === text)
        ?.click();
    });
    await settle();
  }

  async function fill(placeholder: string, value: string) {
    const input = [...document.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.placeholder === placeholder,
    );
    if (!input) throw new Error(`没有找到输入框：${placeholder}`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function lastQuery() {
    const calls = adminApi.fetchAdminUsers.mock.calls;
    return calls[calls.length - 1]?.[0] as Record<string, unknown>;
  }

  it('首屏不带任何筛选：「空串 = 全部」不会把哨兵发给后端', async () => {
    await renderPage();

    expect(lastQuery()).toMatchObject({ page: 1, pageSize: 20 });
    expect(lastQuery()).not.toHaveProperty('keyword');
    expect(lastQuery()).not.toHaveProperty('status');
  });

  it('关键词下发到服务端，`#42` 这类写法先归一掉', async () => {
    await renderPage();
    await fill(KEYWORD_PLACEHOLDER, '#42');
    await clickButton('查询');

    expect(lastQuery()).toMatchObject({ keyword: '42', page: 1 });
  });

  it('翻页把页码发给服务端；换筛选条件后回到第 1 页', async () => {
    adminApi.fetchAdminUsers.mockResolvedValue({ list: [], total: 41 });
    await renderPage();

    await clickButton('下一页');
    expect(lastQuery()).toMatchObject({ page: 2 });

    await fill(KEYWORD_PLACEHOLDER, 'ali');
    await clickButton('查询');
    expect(lastQuery()).toMatchObject({ page: 1, keyword: 'ali' });
  });

  it('累计充值列表头带口径说明', async () => {
    await renderPage();

    const th = [...document.querySelectorAll('th')].find((el) =>
      el.textContent?.includes('累计充值'),
    );
    expect(th?.querySelector('button[aria-label="累计充值的口径"]')).not.toBeNull();
  });
});
