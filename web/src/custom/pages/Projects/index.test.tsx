// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectPageData, ProjectRecord } from '@/custom/api/projects';
import Projects from './index';

const projectApi = vi.hoisted(() => ({
  fetchProjectPage: vi.fn(),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  batchDeleteProjects: vi.fn(),
  pinProject: vi.fn(),
}));

vi.mock('@/custom/api/projects', async () => {
  const actual = await vi.importActual<typeof import('@/custom/api/projects')>('@/custom/api/projects');
  return {
    ...actual,
    touchProjectLastOpened: vi.fn(async () => undefined),
    projectKeys: {
      all: ['projects'],
      pages: (size: number) => ['projects', 'pages', size],
    },
    projectPageQueryOptions: () => ({
      queryKey: ['projects', 'pages', 30],
      initialPageParam: 1,
      queryFn: ({ pageParam }: { pageParam: number }) => projectApi.fetchProjectPage(pageParam),
      getNextPageParam: () => undefined,
    }),
    createProject: projectApi.createProject,
    renameProject: projectApi.renameProject,
    deleteProject: projectApi.deleteProject,
    batchDeleteProjects: projectApi.batchDeleteProjects,
    pinProject: projectApi.pinProject,
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let mountNode: HTMLDivElement | undefined;

const projects: ProjectRecord[] = [
  {
    id: 'with-previews',
    name: '有预览项目',
    previews: [
      { url: 'https://cdn.example.test/previews/one.png', type: 'image' },
      { url: 'https://cdn.example.test/previews/two.png', type: 'image' },
      { url: 'https://cdn.example.test/previews/three.png', type: 'image' },
      { url: 'https://cdn.example.test/previews/four.mp4', type: 'video' },
    ],
    created_at: '2026-09-04T00:00:00.000Z',
    last_opened_at: null,
    last_edited_at: '2026-09-04T00:00:00.000Z',
    pinned_at: '2026-09-10T00:00:00.000Z',
  },
  {
    id: 'without-previews',
    name: '空预览项目',
    previews: [],
    created_at: '2026-09-03T00:00:00.000Z',
    last_opened_at: null,
    last_edited_at: '2026-09-03T00:00:00.000Z',
    pinned_at: null,
  },
];

function LocationProbe() {
  const location = useLocation();
  return createElement(
    'output',
    { 'data-testid': 'location' },
    `${location.pathname}${location.search}`,
  );
}

function withProviders(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return createElement(
    QueryClientProvider,
    { client },
    createElement(
      MemoryRouter,
      { initialEntries: ['/projects'] },
      node,
      createElement(LocationProbe),
    ),
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root?.render(withProviders(createElement(Projects)));
  });

  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (document.body.querySelector('[aria-label="打开项目 有预览项目"]')) return;
    await settle();
  }
  throw new Error(`项目列表仍未加载: ${document.body.textContent}`);
}

async function renderLoadingPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root?.render(withProviders(createElement(Projects)));
  });
  await settle();
}

function pageData(): ProjectPageData {
  return {
    records: projects,
    total: projects.length,
    size: 30,
    current: 1,
  };
}

beforeEach(() => {
  notifyManager.setScheduler((callback) => callback());
  projectApi.fetchProjectPage.mockResolvedValue(pageData());
});

afterEach(async () => {
  notifyManager.setScheduler((callback) => { setTimeout(callback, 0); });
  vi.clearAllMocks();
  if (root) await act(async () => root?.unmount());
  mountNode?.remove();
  root = undefined;
  mountNode = undefined;
});

describe('Projects 项目卡片页', () => {
  it('首屏请求未完成时渲染与项目卡片同布局的骨架屏', async () => {
    projectApi.fetchProjectPage.mockImplementation(() => new Promise(() => {}));
    await renderLoadingPage();

    expect(document.body.querySelector('[role="status"][aria-label="正在加载项目"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[data-project-card-skeleton]')).toHaveLength(6);
    expect(document.body.querySelectorAll('[data-project-card-skeleton-media]')).toHaveLength(6);
    expect(document.body.textContent).not.toContain('正在加载项目…');
    expect(document.body.querySelector('[aria-label="项目列表"]')).toBeNull();
  });

  it('从首屏分页数据渲染三张预览图，并为无图项目显示占位', async () => {
    await renderPage();

    expect(projectApi.fetchProjectPage).toHaveBeenCalledWith(1);
    expect(document.body.querySelectorAll('img[alt^="有预览项目 图片预览"]')).toHaveLength(3);
    expect(document.body.querySelector('img[alt="有预览项目 图片预览 4"]')).toBeNull();
    expect(document.body.querySelector('[aria-label="暂无内容预览"]')?.textContent).toContain('暂无内容预览');
  });

  it('点击项目卡片在新标签页打开该项目，当前页不停留跳转', async () => {
    const open = vi.fn(() => ({}));
    const originalOpen = window.open;
    window.open = open as unknown as typeof window.open;
    try {
      await renderPage();
      const card = document.body.querySelector<HTMLElement>('[aria-label="打开项目 有预览项目"]');
      if (!card) throw new Error('项目卡片未渲染');

      await act(async () => { card.click(); });

      expect(open).toHaveBeenCalledWith('/canvas?project=with-previews', '_blank');
      expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe('/projects');
    } finally {
      window.open = originalOpen;
    }
  });

  it('多选时卡片本身不变色，仅通过勾选控件标记已选', async () => {
    await renderPage();
    const enterSelectionMode = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '批量管理');
    if (!enterSelectionMode) throw new Error('批量管理按钮未渲染');
    await act(async () => { enterSelectionMode.click(); });

    const card = document.body.querySelector<HTMLElement>('[aria-label="选择项目 有预览项目"]');
    if (!card) throw new Error('多选项目卡片未渲染');
    const classNameBeforeSelection = card.className;

    await act(async () => { card.click(); });

    expect(card.className).toBe(classNameBeforeSelection);
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(card.getAttribute('aria-pressed')).toBe('true');
    const toggle = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="取消选择 有预览项目"]',
    );
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(toggle?.querySelector('svg')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe('/projects');
  });

  it('从更多操作打开重命名时预填当前项目名称', async () => {
    await renderPage();
    const more = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="有预览项目 的更多操作"]',
    );
    if (!more) throw new Error('项目更多操作按钮未渲染');

    await act(async () => { more.click(); });
    const rename = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '重命名');
    if (!rename) throw new Error('重命名操作未渲染');
    await act(async () => { rename.click(); });
    await settle();

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('重命名项目');
    expect(dialog?.querySelector<HTMLInputElement>('input')?.value).toBe('有预览项目');
  });

  it('置顶项目卡片渲染图钉角标，More 菜单显示「取消置顶」', async () => {
    await renderPage();

    expect(document.body.querySelector('span[title="已置顶"]')).not.toBeNull();

    const more = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="有预览项目 的更多操作"]',
    );
    if (!more) throw new Error('置顶项目更多操作按钮未渲染');
    await act(async () => { more.click(); });

    expect([...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .some((button) => button.textContent?.trim() === '取消置顶')).toBe(true);
    expect([...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .some((button) => button.textContent?.trim() === '重命名')).toBe(true);
    expect([...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .some((button) => button.textContent?.trim() === '删除项目')).toBe(true);
  });

  it('未置顶项目 More 菜单显示「置顶」，点击调 pinProject(id, true) 并刷新列表', async () => {
    projectApi.pinProject.mockResolvedValue({ ...projects[1], pinned_at: '2026-09-19T00:00:00.000Z' });
    await renderPage();
    const callsAfterLoad = projectApi.fetchProjectPage.mock.calls.length;

    const more = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="空预览项目 的更多操作"]',
    );
    if (!more) throw new Error('未置顶项目更多操作按钮未渲染');
    await act(async () => { more.click(); });

    const pinItem = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '置顶');
    if (!pinItem) throw new Error('置顶操作未渲染');
    await act(async () => { pinItem.click(); });
    await settle();

    expect(projectApi.pinProject).toHaveBeenCalledWith('without-previews', true, { silent: true });
    expect(projectApi.fetchProjectPage.mock.calls.length).toBeGreaterThan(callsAfterLoad);
  });
});
