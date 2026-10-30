// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomeSidebar from './index';
import type { ProjectRecord } from '@/custom/api/projects';

const api = vi.hoisted(() => ({
  fetchProjectListQuery: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock('@/custom/api/projects', async () => {
  const actual = await vi.importActual<typeof import('@/custom/api/projects')>('@/custom/api/projects');
  return { ...actual, ...api };
});

const auth = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  subscribe: () => () => {},
}));

vi.mock('@/shared/utils/auth', () => ({
  getCurrentUser: () => auth.user,
  subscribe: auth.subscribe,
}));
vi.mock('@/custom/components/LoginModal', () => ({
  default: () => createElement('div', { 'data-testid': 'login-modal' }),
}));

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/custom/components/Toast', () => ({ showToast: toast.showToast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;
let location = '';

function LocationProbe() {
  location = useLocation().pathname;
  return null;
}

function record(id: string, name: string): ProjectRecord {
  return {
    id,
    name,
    previews: [],
    created_at: '2026-10-28T14:30:00+08:00',
    last_opened_at: null,
    last_edited_at: '2026-10-28T16:00:00+08:00',
    pinned_at: null,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSidebar(props: { expanded?: boolean; route?: string } = {}) {
  const onExpandedChange = vi.fn();
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [props.route ?? '/'] },
        createElement(HomeSidebar, { expanded: props.expanded ?? true, onExpandedChange }),
        createElement(LocationProbe),
      ),
    );
  });
  await flush();
  return onExpandedChange;
}

function navButtons(): HTMLButtonElement[] {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('nav button')];
}

function items(): HTMLButtonElement[] {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('ul li > button[title]')];
}

function moreButtons(): HTMLButtonElement[] {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === '更多');
}

async function typeSearch(value: string, advanceMs = 1000) {
  const input = mountNode.querySelector<HTMLInputElement>('input[aria-label="搜索项目"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (advanceMs > 0) {
    await act(async () => {
      vi.advanceTimersByTime(advanceMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  auth.user = { id: 'u1' };
  location = '';
  vi.useFakeTimers();
  api.fetchProjectListQuery.mockImplementation(async ({ source, page }: { source: string; page: number }) => {
    if (source === 'dialog') {
      return page === 1
        ? { records: [record('d1', '生成一'), record('d2', '生成二')], total: 3, size: 6, current: 1 }
        : { records: [record('d3', '生成三')], total: 3, size: 6, current: 2 };
    }
    return { records: [record('c1', '画布一')], total: 1, size: 6, current: 1 };
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('侧栏导航', () => {
  it('只有首页、项目、资产三项，不含历史入口', async () => {
    await renderSidebar();

    expect(navButtons().map((b) => b.textContent)).toEqual(['首页', '项目', '资产']);
    expect(mountNode.textContent).not.toContain('历史');
  });

  it('点击项目后跳转并收起侧栏', async () => {
    const onExpandedChange = await renderSidebar();

    await act(async () => { navButtons()[1].click(); });

    expect(location).toBe('/projects');
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it('未登录点击资产先弹登录，不跳转', async () => {
    auth.user = null;
    await renderSidebar();

    await act(async () => { navButtons()[2].click(); });

    expect(mountNode.querySelector('[data-testid="login-modal"]')).not.toBeNull();
    expect(location).toBe('/');
  });

  it('收起态展开按钮可切换', async () => {
    const onExpandedChange = await renderSidebar({ expanded: false });
    const toggle = mountNode.querySelector<HTMLButtonElement>('button[aria-expanded]')!;

    expect(toggle.getAttribute('aria-label')).toBe('展开侧栏');
    await act(async () => { toggle.click(); });
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });
});

describe('首页搜索与项目列表', () => {
  it('首页展开时显示搜索框，按 source 分「生成」「画布」两组', async () => {
    await renderSidebar();

    expect(mountNode.querySelector('input[aria-label="搜索项目"]')).not.toBeNull();
    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'dialog', page: 1, size: 6 }));
    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'canvas', page: 1, size: 6 }));
    const headings = [...mountNode.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['生成', '画布']);
    expect(items().map((b) => b.textContent)).toEqual(['生成一', '生成二', '画布一']);
  });

  it('项目页展开时不显示搜索与项目列表', async () => {
    await renderSidebar({ route: '/projects' });

    expect(mountNode.querySelector('input[aria-label="搜索项目"]')).toBeNull();
    expect(mountNode.querySelector('h3')).toBeNull();
    expect(api.fetchProjectListQuery).not.toHaveBeenCalled();
  });

  it('缩略图取预览第一项，图片项渲染 img、视频项渲染 video，无预览时用默认图标', async () => {
    api.fetchProjectListQuery.mockImplementation(async ({ source }: { source: string }) =>
      source === 'dialog'
        ? {
            records: [
              { ...record('d1', '图片项目'), previews: [{ url: 'https://cdn.test/a.png', type: 'image' }] },
              { ...record('d2', '视频项目'), previews: [{ url: 'https://cdn.test/b.mp4', type: 'video' }] },
              { ...record('d3', '空项目'), previews: [] },
            ],
            total: 3,
            size: 6,
            current: 1,
          }
        : { records: [], total: 0, size: 6, current: 1 },
    );
    await renderSidebar();

    const thumbs = [...mountNode.querySelectorAll<HTMLElement>('ul li')].slice(0, 3).map((li) => li.querySelector('span'));
    expect(thumbs[0]?.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/a.png');
    expect(thumbs[1]?.querySelector('video')?.getAttribute('src')).toBe('https://cdn.test/b.mp4');
    expect(thumbs[1]?.querySelector('img')).toBeNull();
    expect(thumbs[2]?.querySelector('img')).toBeNull();
    expect(thumbs[2]?.querySelector('video')).toBeNull();
    expect(thumbs[2]?.querySelector('svg')).not.toBeNull();
  });

  it('首页收起态保留项目缩略图、不显示搜索框与项目名', async () => {
    await renderSidebar({ expanded: false });

    expect(mountNode.querySelector('input[aria-label="搜索项目"]')).toBeNull();
    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'dialog', page: 1 }));
    expect(mountNode.querySelectorAll('ul li')).toHaveLength(3);
    expect(items()[0].querySelector('img, video, svg')).not.toBeNull();
    expect(mountNode.querySelectorAll('h3')).toHaveLength(2);
  });

  it('「更多」翻页并追加到该组', async () => {
    await renderSidebar();

    await act(async () => {
      moreButtons()[0].click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'dialog', page: 2 }));
    expect(items().map((b) => b.textContent)).toEqual(['生成一', '生成二', '生成三', '画布一']);
  });

  it('搜索防抖 1 秒：输入后未满 1 秒不发请求，显示搜索中', async () => {
    await renderSidebar();
    api.fetchProjectListQuery.mockClear();

    await typeSearch('海报', 999);
    expect(api.fetchProjectListQuery).not.toHaveBeenCalled();
    expect(mountNode.textContent).toContain('搜索中…');

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'dialog', keyword: '海报' }));
    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'canvas', keyword: '海报' }));
  });

  it('两组都为空且有搜索词时显示空态', async () => {
    api.fetchProjectListQuery.mockResolvedValue({ records: [], total: 0, size: 6, current: 1 });
    await renderSidebar();
    await typeSearch('不存在');

    expect(mountNode.textContent).toContain('没有匹配的项目');
  });
});
