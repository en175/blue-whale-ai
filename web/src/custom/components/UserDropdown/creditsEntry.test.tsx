// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSession, type SessionUser } from '@/shared/utils/auth';
import UserDropdown from './index';

vi.mock('@/custom/api/auth', () => ({
  accountProfileKeys: { all: ['account-profile'] },
  fetchCredits: vi.fn(async () => ({ credits: 10 })),
  logout: vi.fn(async () => null),
}));

vi.mock('./AccountModal', () => ({ default: () => null }));
vi.mock('./RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/components/LoginModal', () => ({ default: () => null }));

const USER: SessionUser = {
  userId: 1,
  username: 'alice',
  nickname: 'alice',
  email: '',
  phone: '',
  hasPassword: true,
  isAdmin: false,
};

let root: Root;
let mountNode: HTMLDivElement;

async function renderMenu() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(MemoryRouter, null, createElement(UserDropdown)),
      ),
    );
  });
}

async function openMenu() {
  const trigger = document.body.querySelector('button[aria-label]');
  await act(async () => {
    trigger?.parentElement?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  setSession(USER);
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  localStorage.clear();
  setSession(null);
  vi.restoreAllMocks();
});

describe('UserDropdown 未登录入口', () => {
  it('未登录时只展示一个注册/登录按钮', async () => {
    setSession(null);
    await renderMenu();
    expect([...document.body.querySelectorAll('button')].map((button) => button.textContent?.trim())).toEqual([
      '注册/登录',
    ]);
  });
});

describe('UserDropdown 头像占位', () => {
  it('优先用昵称首字母，缺昵称回退用户名', async () => {
    setSession({ ...USER, username: 'alice', nickname: '蓝鲸用户' });
    await renderMenu();
    expect(document.body.querySelector('button[aria-label="蓝鲸用户"]')?.textContent).toBe('蓝');
    await act(async () => root.unmount());
    mountNode.remove();
    setSession({ ...USER, username: 'alice' });
    await renderMenu();
    expect(document.body.querySelector('button[aria-label="alice"]')?.textContent).toBe('A');
  });
});

describe('UserDropdown 昵称展示', () => {
  it('菜单标题展示昵称，缺昵称回退用户名', async () => {
    setSession({ ...USER, username: 'alice', nickname: '蓝鲸用户' });
    await renderMenu();
    await openMenu();
    const title = [...document.body.querySelectorAll('span')].find((el) => el.textContent === '蓝鲸用户');
    expect(title?.textContent).toBe('蓝鲸用户');
    await act(async () => root.unmount());
    mountNode.remove();
    setSession({ ...USER, username: 'alice' });
    await renderMenu();
    await openMenu();
    const fallback = [...document.body.querySelectorAll('span')].find((el) => el.textContent === 'alice');
    expect(fallback?.textContent).toBe('alice');
  });
});

describe('UserDropdown 积分管理入口', () => {
  it('点击积分管理新开独立页', async () => {
    await renderMenu();
    const trigger = document.body.querySelector('button[aria-label="alice"]');
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger?.parentElement?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    const creditsBtn = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('积分管理'),
    );
    expect(creditsBtn).toBeTruthy();
    await act(async () => {
      creditsBtn?.click();
    });
    expect(window.open).toHaveBeenCalledWith('/account/credits', '_blank', 'noopener,noreferrer');
  });
});
