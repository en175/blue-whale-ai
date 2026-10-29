// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore, type SessionUser } from '@/shared/stores/auth';
import Home from './index';

vi.mock('@/custom/components/UserDropdown', () => ({
  default: function MockUserDropdown() {
    return createElement('div', { 'data-testid': 'user-dropdown' });
  },
}));

vi.mock('./components/CardGallery', () => ({
  default: function MockCardGallery() {
    return createElement('div', { 'data-testid': 'card-gallery' });
  },
}));

vi.mock('./components/CanvasEntry', () => ({
  default: function MockCanvasEntry() {
    return createElement('div', { 'data-testid': 'canvas-entry' });
  },
}));

vi.mock('./components/ChatBox', () => ({
  default: function MockChatBox({ workspace }: { workspace: string }) {
    return createElement('div', { 'data-testid': 'chat-box', 'data-workspace': workspace });
  },
}));

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

describe('Home 主语与切换', () => {
  it('标语为单行「让想象有画面，让表达有回响」，无句号', async () => {
    await renderHome();

    const title = mountNode.querySelector('h1');
    expect(title?.textContent).toBe('让想象有画面，让表达有回响');
    expect(title?.textContent).not.toMatch(/[。.]$/);
  });

  it('主切换只有「生成」「画布」两项', async () => {
    await renderHome();

    const items = [...mountNode.querySelectorAll('[aria-label="工作方式"] button')].map((b) => b.textContent);
    expect(items).toEqual(['生成', '画布']);
  });

  it('只在「生成」下展示案例，「画布」下换成新建与最近项目位', async () => {
    await renderHome();

    expect(mountNode.querySelector('[data-testid="chat-box"]')?.getAttribute('data-workspace')).toBe('create');
    expect(mountNode.querySelector('[data-testid="card-gallery"]')).not.toBeNull();
    expect(mountNode.querySelector('[data-testid="canvas-entry"]')).toBeNull();

    const canvasButton = [...mountNode.querySelectorAll<HTMLButtonElement>('[aria-label="工作方式"] button')].find(
      (b) => b.textContent === '画布',
    );
    await act(async () => {
      canvasButton?.click();
    });

    expect(mountNode.querySelector('[data-testid="chat-box"]')?.getAttribute('data-workspace')).toBe('canvas');
    expect(mountNode.querySelector('[data-testid="card-gallery"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="canvas-entry"]')).not.toBeNull();
  });
});
