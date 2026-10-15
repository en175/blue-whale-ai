// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSession, type SessionUser } from '@/shared/utils/auth';
import UserDropdown from './index';

vi.mock('@/app/api/auth', () => ({
  fetchCredits: vi.fn(async () => ({ credits: 10 })),
  logout: vi.fn(async () => null),
}));

vi.mock('./AccountModal', () => ({ default: () => null }));
vi.mock('./RechargeModal', () => ({ default: () => null }));
vi.mock('@/app/components/LoginModal', () => ({ default: () => null }));

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

async function renderMenu() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(UserDropdown)));
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
