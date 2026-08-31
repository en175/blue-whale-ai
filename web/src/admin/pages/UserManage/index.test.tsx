// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserManage from './index';
import styles from './index.module.css';

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

describe('UserManage 用户 ID 展示', () => {
  it('列表用户 ID 与接口字段一致，不带 # 前缀', async () => {
    await renderPage();
    expect(document.body.querySelector(`.${styles.cellId}`)?.textContent).toBe('42');
  });

  it('详情里的用户 ID 同样不带 #', async () => {
    await renderPage();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`.${styles.nickLink}`)?.click();
    });
    const labels = [...document.body.querySelectorAll(`.${styles.infoLabel}`)];
    const idLabel = labels.find((el) => el.textContent === '用户ID');
    expect(idLabel?.nextElementSibling?.textContent).toBe('42');
  });
});
