// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SiteConfig from './index';

const api = vi.hoisted(() => ({
  fetchAdminHomepageHeroes: vi.fn(),
  createHomepageHero: vi.fn(),
  updateHomepageHero: vi.fn(),
  deleteHomepageHero: vi.fn(),
  sortHomepageHero: vi.fn(),
  uploadHomepageHeroFile: vi.fn(),
}));

vi.mock('@/api/homepageHeroes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/homepageHeroes')>();
  return {
    ...actual,
    fetchAdminHomepageHeroes: api.fetchAdminHomepageHeroes,
    createHomepageHero: api.createHomepageHero,
    updateHomepageHero: api.updateHomepageHero,
    deleteHomepageHero: api.deleteHomepageHero,
    sortHomepageHero: api.sortHomepageHero,
    uploadHomepageHeroFile: api.uploadHomepageHeroFile,
    adminHomepageHeroesOptions: () => ({
      queryKey: actual.homepageHeroKeys.admin(),
      queryFn: () => api.fetchAdminHomepageHeroes(),
    }),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;

const sample = {
  id: '11',
  media_type: 'video' as const,
  media_url: 'https://cdn.example.com/hero.mp4',
  poster_url: 'https://cdn.example.com/hero.jpg',
  sort_order: 0,
  enabled: 1,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T12:00:00.000Z',
};

function withQuery(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, node);
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitUntilLoaded() {
  for (let i = 0; i < 25; i += 1) {
    if (!document.body.textContent?.includes('加载中…')) return;
    await settle();
  }
  throw new Error(`列表仍在加载: ${document.body.textContent}`);
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(SiteConfig)));
  });
  await waitUntilLoaded();
}

function buttons() {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')];
}

async function upload(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchAdminHomepageHeroes.mockResolvedValue([sample]);
  api.createHomepageHero.mockResolvedValue({ id: '12' });
  api.updateHomepageHero.mockResolvedValue({ id: '11' });
  api.deleteHomepageHero.mockResolvedValue({ id: '11' });
  api.sortHomepageHero.mockResolvedValue({ id: '11' });
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('SiteConfig 通用配置', () => {
  it('渲染列表预览、类型与待填地址', async () => {
    api.fetchAdminHomepageHeroes.mockResolvedValue([
      { ...sample, media_url: '', poster_url: null, media_type: 'image', enabled: 0 },
    ]);
    await renderPage();
    expect(document.body.textContent).toContain('通用配置');
    expect(document.body.textContent).toContain('图片');
    expect(document.body.textContent).toContain('待填地址');
    expect(document.body.textContent).toContain('停用');
    expect(document.body.textContent).toContain('首页默认兜底背景');
    expect(document.querySelector('img[alt="首页默认兜底背景"]')).not.toBeNull();
    expect(document.querySelector('thead th')?.textContent).toBe('拖拽排序');
  });

  it('视频未配封面图不能保存', async () => {
    await renderPage();
    await act(async () => {
      buttons().find((btn) => btn.textContent?.includes('新建条目'))?.click();
    });
    const video = document.body.querySelector<HTMLInputElement>('[data-testid="hero-video-upload"]');
    if (!video) throw new Error('视频上传控件未渲染');
    api.uploadHomepageHeroFile.mockResolvedValueOnce('https://cdn.example.com/hero.mp4');
    await upload(video, new File(['video'], 'hero.mp4', { type: 'video/mp4' }));
    await act(async () => {
      buttons().find((btn) => btn.textContent === '保存')?.click();
    });
    expect(document.body.querySelector('[role="dialog"] [role="status"]')?.textContent).toBe('请先上传封面图');
    expect(api.createHomepageHero).not.toHaveBeenCalled();
  });

  it('只上传封面图时按静态图片背景保存', async () => {
    await renderPage();
    await act(async () => {
      buttons().find((btn) => btn.textContent?.includes('新建条目'))?.click();
    });
    const cover = document.body.querySelector<HTMLInputElement>('[data-testid="hero-cover-upload"]');
    if (!cover) throw new Error('封面图上传控件未渲染');
    api.uploadHomepageHeroFile.mockResolvedValueOnce('https://cdn.example.com/hero.png');
    await upload(cover, new File(['image'], 'hero.png', { type: 'image/png' }));
    expect(document.body.querySelector('[data-testid="hero-video-upload"]')).not.toBeNull();
    expect(document.body.querySelector<HTMLImageElement>('[data-testid="hero-cover-preview"]')?.src)
      .toBe('https://cdn.example.com/hero.png');

    await act(async () => {
      buttons().find((btn) => btn.textContent === '保存')?.click();
    });
    await settle();
    expect(api.createHomepageHero).toHaveBeenCalledWith(
      expect.objectContaining({
        media_type: 'image',
        media_url: 'https://cdn.example.com/hero.png',
        poster_url: null,
      }),
      { silent: true },
    );
  });

  it('封面图与视频分别上传，并把启用状态写成 0/1', async () => {
    await renderPage();
    await act(async () => {
      buttons().find((btn) => btn.textContent?.includes('新建条目'))?.click();
    });
    expect(document.body.querySelector('input[aria-label="媒体地址"]')).toBeNull();
    expect(document.body.querySelector('input[aria-label="封面地址"]')).toBeNull();
    const cover = document.body.querySelector<HTMLInputElement>('[data-testid="hero-cover-upload"]');
    const video = document.body.querySelector<HTMLInputElement>('[data-testid="hero-video-upload"]');
    if (!cover || !video) throw new Error('上传控件未渲染');
    api.uploadHomepageHeroFile
      .mockResolvedValueOnce('https://cdn.example.com/cover.jpg')
      .mockResolvedValueOnce('https://cdn.example.com/hero.mp4');
    await upload(cover, new File(['image'], 'cover.jpg', { type: 'image/jpeg' }));
    await upload(video, new File(['video'], 'hero.mp4', { type: 'video/mp4' }));
    expect(document.body.querySelector<HTMLImageElement>('[data-testid="hero-cover-preview"]')?.src)
      .toBe('https://cdn.example.com/cover.jpg');
    const videoPreview = document.body.querySelector<HTMLVideoElement>('[data-testid="hero-video-preview"]');
    expect(videoPreview?.getAttribute('src')).toBe('https://cdn.example.com/hero.mp4');
    expect(videoPreview?.getAttribute('poster')).toBe('https://cdn.example.com/cover.jpg');
    await act(async () => {
      buttons().find((btn) => btn.textContent === '保存')?.click();
    });
    await settle();
    expect(api.createHomepageHero).toHaveBeenCalledWith(
      expect.objectContaining({
        media_type: 'video',
        media_url: 'https://cdn.example.com/hero.mp4',
        poster_url: 'https://cdn.example.com/cover.jpg',
        enabled: 1,
      }),
      { silent: true },
    );
  });

  it('启停、拖拽排序、删除走对应接口', async () => {
    api.fetchAdminHomepageHeroes.mockResolvedValue([
      sample,
      { ...sample, id: '12', sort_order: 1, media_url: 'https://cdn.example.com/b.mp4' },
      { ...sample, id: '13', sort_order: 2, media_url: 'https://cdn.example.com/c.mp4' },
    ]);
    await renderPage();
    const toggle = document.body.querySelector<HTMLButtonElement>('[data-testid="hero-toggle-11"]');
    const dragHandle = document.body.querySelector<HTMLButtonElement>('[data-testid="hero-drag-handle-11"]');
    const sourceRow = document.body.querySelector<HTMLTableRowElement>('[data-testid="hero-row-11"]');
    const targetRow = document.body.querySelector<HTMLTableRowElement>('[data-testid="hero-row-13"]');
    const remove = document.body.querySelector<HTMLButtonElement>('[data-testid="hero-delete-11"]');
    if (!toggle || !dragHandle || !sourceRow || !targetRow || !remove) {
      throw new Error(`列表操作按钮未渲染: ${document.body.textContent}`);
    }
    expect(sourceRow.cells[0].contains(dragHandle)).toBe(true);

    await act(async () => { toggle.click(); });
    await settle();
    expect(api.updateHomepageHero).toHaveBeenCalledWith('11', { enabled: 0 });

    await act(async () => {
      dragHandle.dispatchEvent(new Event('dragstart', { bubbles: true }));
    });
    await settle();
    await act(async () => {
      targetRow.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
      targetRow.dispatchEvent(new Event('drop', { bubbles: true }));
    });
    await settle();
    expect(api.sortHomepageHero).toHaveBeenCalledTimes(2);
    expect(api.sortHomepageHero).toHaveBeenNthCalledWith(1, '11', 'down');
    expect(api.sortHomepageHero).toHaveBeenNthCalledWith(2, '11', 'down');

    await act(async () => { remove.click(); });
    await act(async () => {
      buttons().find((btn) => btn.textContent === '确认删除')?.click();
    });
    await settle();
    expect(api.deleteHomepageHero).toHaveBeenCalledWith('11');
  });
});
