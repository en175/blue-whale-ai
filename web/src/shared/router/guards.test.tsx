// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RequireAuth } from './guards';
import { setSession, type SessionUser } from '@/shared/utils/auth';

const loggedInUser: SessionUser = {
  userId: 1,
  username: 'tester',
  email: 't@example.com',
  phone: '13800000000',
  hasPassword: true,
  isAdmin: false,
};

function GuardedApp() {
  return createElement(
    Routes,
    null,
    createElement(Route, { path: '/', element: createElement('div', null, 'home') }),
    createElement(Route, {
      path: '/canvas',
      element: createElement(RequireAuth, null, createElement('div', null, 'canvas')),
    }),
    createElement(Route, {
      path: '/projects',
      element: createElement(RequireAuth, null, createElement('div', null, 'projects')),
    }),
    createElement(Route, {
      path: '/library',
      element: createElement(RequireAuth, null, createElement('div', null, 'library')),
    }),
  );
}

let root: Root;
let mountNode: HTMLDivElement;

async function renderAt(path: string) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(GuardedApp)),
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  setSession(null);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  localStorage.clear();
  setSession(null);
});

describe('RequireAuth', () => {
  it('未登录访问画布/项目/资产时打回首页', async () => {
    for (const path of ['/canvas', '/projects', '/library']) {
      await renderAt(path);
      expect(mountNode.textContent).toBe('home');
      await act(async () => root.unmount());
      mountNode.remove();
    }
  });

  it('未登录仍可停留首页', async () => {
    await renderAt('/');
    expect(mountNode.textContent).toBe('home');
  });

  it('已登录可进入画布', async () => {
    setSession(loggedInUser);
    await renderAt('/canvas');
    expect(mountNode.textContent).toBe('canvas');
  });

  it('会话清空后从画布打回首页', async () => {
    setSession(loggedInUser);
    await renderAt('/canvas');
    expect(mountNode.textContent).toBe('canvas');

    await act(async () => {
      setSession(null);
    });
    expect(mountNode.textContent).toBe('home');
  });
});
