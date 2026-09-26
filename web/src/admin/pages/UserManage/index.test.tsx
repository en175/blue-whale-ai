// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserManage from './index';

const adminApi = vi.hoisted(() => ({
  fetchAdminUsers: vi.fn(),
  manageAdminUser: vi.fn(),
  fetchOperationLogs: vi.fn(),
}));

vi.mock('@/api/admin', () => adminApi);

let root: Root;
let mountNode: HTMLDivElement;

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(UserManage));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
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
});

afterEach(async () => {
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
