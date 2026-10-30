// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from './MainLayout';

vi.mock('@/custom/pages/Home/components/HomeSidebar', () => ({
  default: function MockHomeSidebar({ expanded }: { expanded: boolean }) {
    return createElement('aside', { 'data-testid': 'home-sidebar', 'data-expanded': String(expanded) });
  },
}));

vi.mock('@/shared/seo/useDocumentTitle', () => ({
  useDocumentTitle: () => undefined,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;

async function renderAt(pathname: string) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [pathname] },
        createElement(MainLayout),
      ),
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('MainLayout 侧栏归属', () => {
  it.each(['/', '/projects', '/library'])('%s 使用统一侧栏', async (pathname) => {
    await renderAt(pathname);

    expect(mountNode.querySelector('[data-testid="home-sidebar"]')).not.toBeNull();
    expect(mountNode.querySelector('[data-sidebar="compact"]')).not.toBeNull();
  });

  it('画布页不渲染侧栏', async () => {
    await renderAt('/canvas');

    expect(mountNode.querySelector('[data-testid="home-sidebar"]')).toBeNull();
    expect(mountNode.querySelector('[data-sidebar="none"]')).not.toBeNull();
  });

  it('非首页不渲染背景轮播', async () => {
    await renderAt('/projects');

    expect(mountNode.querySelector('video')).toBeNull();
    expect(mountNode.querySelector('section')).toBeNull();
  });
});
