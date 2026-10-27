// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RequireAuth } from './guards';
import { setSession, type SessionUser } from '@/shared/utils/auth';
import { useLoginDialogStore } from '@/shared/stores/loginDialog';

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

async function unmount() {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  setSession(null);
  useLoginDialogStore.getState().closeLogin();
});

afterEach(async () => {
  await unmount();
  localStorage.clear();
  setSession(null);
  useLoginDialogStore.getState().closeLogin();
});

describe('RequireAuth', () => {
  it('未登录访问画布/项目/资产时保留目标地址并弹出登录框', async () => {
    for (const path of ['/canvas', '/projects', '/library']) {
      await renderAt(path);
      expect(mountNode.textContent).toBe('home');
      expect(useLoginDialogStore.getState().open).toBe(true);
      expect(useLoginDialogStore.getState().returnTo).toBe(path);
      await unmount();
      useLoginDialogStore.getState().closeLogin();
    }
  });

  it('未登录访问带 query 的受保护页时记录完整原目标，供登录后回跳', async () => {
    await renderAt('/canvas?project=42');
    expect(useLoginDialogStore.getState().returnTo).toBe('/canvas?project=42');
  });

  it('未登录仍可停留首页且不弹登录框', async () => {
    await renderAt('/');
    expect(mountNode.textContent).toBe('home');
    expect(useLoginDialogStore.getState().open).toBe(false);
  });

  it('已登录可进入画布且不弹登录框', async () => {
    setSession(loggedInUser);
    await renderAt('/canvas');
    expect(mountNode.textContent).toBe('canvas');
    expect(useLoginDialogStore.getState().open).toBe(false);
  });

  it('会话清空后立即弹出登录框，不再静默跳首页', async () => {
    setSession(loggedInUser);
    await renderAt('/canvas');
    expect(mountNode.textContent).toBe('canvas');

    await act(async () => {
      setSession(null);
    });
    expect(useLoginDialogStore.getState().open).toBe(true);
    expect(useLoginDialogStore.getState().returnTo).toBe('/canvas');
  });
});
