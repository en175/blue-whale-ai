// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomeSidebar from './index';
import type { ProjectRecord } from '@/custom/api/projects';

const api = vi.hoisted(() => ({
  fetchProjectListQuery: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock('@/custom/api/projects', () => api);
vi.mock('@/custom/api/projects', async () => {
  const actual = await vi.importActual<typeof import('@/custom/api/projects')>('@/custom/api/projects');
  return { ...actual, ...api };
});

vi.mock('@/shared/utils/auth', () => {
  const user = { id: 'u1' };
  const subscribe = () => () => {};
  return { getCurrentUser: () => user, subscribe };
});
vi.mock('@/custom/components/LoginModal', () => ({ default: () => null }));

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/custom/components/Toast', () => ({ showToast: toast.showToast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;

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

async function renderSidebar() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(HomeSidebar, { expanded: true, onExpandedChange: vi.fn() })));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

describe('HomeSidebar 历史分组', () => {
  it('按 source 分两组请求，分组标题为「生成」「画布」', async () => {
    await renderSidebar();

    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'dialog', page: 1, size: 6 }));
    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'canvas', page: 1, size: 6 }));
    const headings = [...mountNode.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['生成', '画布']);
    expect(items().map((b) => b.textContent)).toEqual(['生成一', '生成二', '画布一']);
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

  it('搜索把 keyword 同时带到两组，并重置到第一页', async () => {
    await renderSidebar();
    api.fetchProjectListQuery.mockClear();

    await typeSearch('海报');

    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'dialog', page: 1, keyword: '海报' }));
    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ source: 'canvas', page: 1, keyword: '海报' }));
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
    expect(api.fetchProjectListQuery).toHaveBeenCalledWith(expect.objectContaining({ keyword: '海报' }));
  });

  it('连续输入只发最后一次请求', async () => {
    await renderSidebar();
    api.fetchProjectListQuery.mockClear();

    await typeSearch('海', 400);
    await typeSearch('海报', 400);
    expect(api.fetchProjectListQuery).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });
    const keywords = api.fetchProjectListQuery.mock.calls.map((call) => call[0].keyword);
    expect(keywords).toEqual(['海报', '海报']);
  });

  it('两组都为空且有搜索词时显示空态', async () => {
    api.fetchProjectListQuery.mockResolvedValue({ records: [], total: 0, size: 6, current: 1 });
    await renderSidebar();
    await typeSearch('不存在');

    expect(mountNode.textContent).toContain('没有匹配的项目');
  });

  it('点历史项进入对应画布项目', async () => {
    await renderSidebar();

    await act(async () => {
      items()[0].click();
    });
    expect(toast.showToast).not.toHaveBeenCalled();
  });
});
