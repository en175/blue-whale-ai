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

// 页面走 Query（IKJ058）：mock 目标换成域模块，且**工厂本身也要桩** ——
// `vi.mock` 换的是模块导出的绑定，而 `adminUsersOptions` 内部引用的仍是模块自己的
// `fetchAdminUsers`，只桩 fetch 不生效。
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

// 详情弹窗的审计日志也走 Query（IKJ058）—— 一并桩掉，
// 否则单测会**真的往外发请求**（页面从 `@/api/adminOperationLogs` 取它）。
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
  // 页面走 Query（IKJ058）：让 Query 的更新同步落地，否则读完一次 Promise 列表还是空的
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

/**
 * 断言口径说明：本页已迁到 @/admin/ui 且**没有私有 CSS 文件**，
 * 测试不能再靠 `index.module.css` 的类名定位元素——改为按**可见文案与结构**定位，
 * 这样断言的仍是「渲染出来的内容」，而不是某个样式类是否存在。
 */
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
    // 基本信息用 Stat 基元：label 在 .top 里，value 是其兄弟节点，
    // 所以取 label 的上两层容器文本 = 「用户ID」+ 值
    const idLabel = [...document.body.querySelectorAll('span')].find(
      (el) => el.textContent === '用户ID',
    );
    expect(idLabel?.parentElement?.parentElement?.textContent).toBe('用户ID42');
  });
});

/**
 * 发放积分：这一组钉的是**钱路径上的两条硬性质**——只加不减、一次意图一把幂等键。
 * 它们错了都不会报错：前者会让管理员以为加了钱其实没加，后者会在超时重发时发两笔。
 */
describe('UserManage 发放积分', () => {
  async function openGrantModal() {
    await renderPage();
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

  /** React 受控输入：直接改 `value` 不触发 onChange，得走原生 setter 再派发 input 事件。 */
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

  it('0 / 负数 / 小数都是非法值：按钮禁用，一笔都不提交', async () => {
    for (const bad of ['0', '-5', '1.5']) {
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
      await openGrantModal();
      await fill('请输入积分数量', bad);
      await fill('请输入原因（必填）', '补偿');

      expect(confirmButton().disabled).toBe(true);
      await act(async () => confirmButton().click());
      expect(adminApi.manageAdminUser).not.toHaveBeenCalled();
    }
  });
});
