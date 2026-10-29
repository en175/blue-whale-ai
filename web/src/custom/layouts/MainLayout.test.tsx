// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from './MainLayout';

vi.mock('@/custom/components/Sidebar', () => ({
  default: function MockSidebar() {
    return createElement('aside', { 'data-testid': 'shared-sidebar' });
  },
}));

vi.mock('@/custom/pages/Home/components/HomeSidebar', () => ({
  default: function MockHomeSidebar() {
    return createElement('aside', { 'data-testid': 'home-sidebar' });
  },
}));

vi.mock('@/custom/pages/Home/components/HeroVideoCarousel', () => ({
  default: function MockHeroVideoCarousel() {
    return null;
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
  it('首页使用专属侧栏，不渲染共用侧栏', async () => {
    await renderAt('/');

    expect(mountNode.querySelector('[data-testid="home-sidebar"]')).not.toBeNull();
    expect(mountNode.querySelector('[data-testid="shared-sidebar"]')).toBeNull();
  });

  it.each(['/projects', '/library', '/history'])('%s 继续使用共用侧栏', async (pathname) => {
    await renderAt(pathname);

    expect(mountNode.querySelector('[data-testid="shared-sidebar"]')).not.toBeNull();
    expect(mountNode.querySelector('[data-testid="home-sidebar"]')).toBeNull();
  });

  it('画布页不渲染任何侧栏', async () => {
    await renderAt('/canvas');

    expect(mountNode.querySelector('[data-testid="shared-sidebar"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="home-sidebar"]')).toBeNull();
  });
});
