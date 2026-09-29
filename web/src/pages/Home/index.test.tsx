// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore, type SessionUser } from '@/stores/auth';
import Home from './index';

vi.mock('@/components/UserDropdown', () => ({
  default: function MockUserDropdown() {
    return createElement('div', { 'data-testid': 'user-dropdown' });
  },
}));

vi.mock('./components/ChatBox', () => ({
  default: function MockChatBox() {
    return null;
  },
}));

vi.mock('./components/CardGallery', () => ({
  default: function MockCardGallery() {
    return null;
  },
}));

const USER: SessionUser = {
  userId: 1,
  username: 'alice',
  email: '',
  phone: '',
  hasPassword: true,
  isAdmin: false,
};

let root: Root;
let mountNode: HTMLDivElement;

async function renderHome() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(Home));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useAuthStore.setState({ user: USER, credits: 100 });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('Home 顶栏', () => {
  it('登录态下三件套顺序为 积分超市 → 积分余额 → 头像', async () => {
    await renderHome();

    const topBar = mountNode.firstElementChild?.firstElementChild;
    expect(topBar?.children).toHaveLength(3);

    const [shop, badge, avatar] = Array.from(topBar?.children ?? []);
    expect(shop.textContent).toBe('积分超市');
    expect(badge.textContent).toBe('100');
    expect(avatar.getAttribute('data-testid')).toBe('user-dropdown');
  });

  it('未登录时顶栏只剩用户入口占位', async () => {
    useAuthStore.setState({ user: null, credits: null });
    await renderHome();

    const topBar = mountNode.firstElementChild?.firstElementChild;
    expect(topBar?.querySelector('[data-testid="user-dropdown"]')).not.toBeNull();
    expect(topBar?.textContent).toBe('');
  });
});
