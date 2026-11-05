// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasEntry from './index';
import type { ProjectRecord } from '@/custom/api/projects';

const api = vi.hoisted(() => ({
  createProject: vi.fn(),
  fetchRecentProjects: vi.fn(),
  fetchProjectListQuery: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/custom/api/projects', async () => {
  const actual = await vi.importActual<typeof import('@/custom/api/projects')>('@/custom/api/projects');
  return {
    ...actual,
    createProject: api.createProject,
    fetchRecentProjects: api.fetchRecentProjects,
    fetchProjectListQuery: api.fetchProjectListQuery,
  };
});
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => api.navigate };
});
vi.mock('@/shared/utils/auth', () => ({ getCurrentUser: () => ({ id: 'u1', userId: 1 }) }));
vi.mock('@/custom/components/LoginModal', () => ({ default: () => null }));
vi.mock('@/custom/components/Toast', () => ({ showToast: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;

function record(id: string, name: string, previews: ProjectRecord['previews'] = []): ProjectRecord {
  return {
    id,
    name,
    previews,
    created_at: '2026-10-28T14:30:00+08:00',
    last_opened_at: null,
    last_edited_at: '2026-10-28T16:00:00+08:00',
    pinned_at: null,
  };
}

async function renderEntry() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CanvasEntry)));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  api.createProject.mockResolvedValue(record('42', 'new'));
  api.fetchProjectListQuery.mockResolvedValue({ records: [], total: 0, size: 30, current: 1 });
  api.fetchRecentProjects.mockResolvedValue([
    record('1', '有图项目', [{ url: 'https://cdn.example.test/a.png', type: 'image' }]),
    record('2', '只有视频', [{ url: 'https://cdn.example.test/b.mp4', type: 'video' }]),
    record('3', '空项目'),
    record('4', '第四个'),
  ]);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.clearAllMocks();
});

describe('CanvasEntry', () => {
  it('用 limit=3 拉最近项目，最多展示 3 个', async () => {
    await renderEntry();

    expect(api.fetchRecentProjects).toHaveBeenCalledWith(3);
    expect(mountNode.textContent).not.toContain('最近项目');
    expect(mountNode.querySelectorAll('[data-testid="canvas-recent-card"]')).toHaveLength(3);
    expect(mountNode.textContent).toContain('空项目');
    expect(mountNode.textContent).not.toContain('第四个');
  });

  it('取列表里第一张图片作为封面，只有视频时用视频首帧', async () => {
    await renderEntry();

    const cards = [...mountNode.querySelectorAll<HTMLElement>('[data-testid="canvas-recent-card"]')];
    const cover = cards[0].querySelector('img');
    expect(cover?.getAttribute('src')).toBe('https://cdn.example.test/a.png');
    expect(cards[0].querySelector('video')).toBeNull();
    expect(cards[1].querySelector('img')).toBeNull();
    expect(cards[1].querySelector('video')?.getAttribute('src')).toBe('https://cdn.example.test/b.mp4');
  });

  it('没有可用素材时显示占位与「暂无内容预览」', async () => {
    await renderEntry();

    const empty = mountNode.querySelectorAll('[data-testid="canvas-recent-empty"]');
    expect(empty).toHaveLength(1);
    expect(empty[0].textContent).toContain('暂无内容预览');
  });

  it('点最近项目在新标签页打开，不创建项目也不离开当前页', async () => {
    const open = vi.fn(() => ({}));
    const originalOpen = window.open;
    window.open = open as unknown as typeof window.open;
    try {
      await renderEntry();

      await act(async () => {
        mountNode.querySelector<HTMLButtonElement>('[data-testid="canvas-recent-card"]')!.click();
      });
      expect(open).toHaveBeenCalledWith('/canvas?project=1', '_blank');
      expect(api.navigate).not.toHaveBeenCalled();
      expect(api.createProject).not.toHaveBeenCalled();
    } finally {
      window.open = originalOpen;
    }
  });

  it('新建画布以 source=canvas 创建并在当前页进入', async () => {
    await renderEntry();

    const button = [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.includes('新建画布'))!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(api.createProject).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { 'Idempotency-Key': expect.any(String) },
      silent: true,
    }), 'canvas');
    expect(api.navigate).toHaveBeenCalledWith('/canvas?project=42');
  });
});

describe('IKST3D 新建画布不留重复项目', () => {
  function canvasButton() {
    return [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.includes('新建画布'))!;
  }

  function freshRecord(id: string, name: string, startedAt: number): ProjectRecord {
    return {
      id,
      name,
      previews: [],
      created_at: new Date(startedAt + 1_000).toISOString(),
      last_opened_at: null,
      last_edited_at: new Date(startedAt + 1_000).toISOString(),
      pinned_at: null,
    };
  }

  it('上一次已建但未进入：再次点击直接进原项目，不再创建', async () => {
    const startedAt = Date.now() - 5_000;
    const name = '2026-11-05 10:00';
    sessionStorage.setItem('bw:home:latest-create-attempt', JSON.stringify({
      id: 'key-1',
      name,
      userId: 1,
      startedAt,
      unsure: false,
      absent: false,
      state: null,
    }));
    api.fetchProjectListQuery.mockResolvedValue({
      records: [freshRecord('p5', name, startedAt)],
      total: 1,
      size: 30,
      current: 1,
    });

    await renderEntry();
    await act(async () => {
      canvasButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.fetchProjectListQuery).toHaveBeenCalledWith({ source: 'canvas' });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.navigate).toHaveBeenCalledWith('/canvas?project=p5');
  });

  it('核对不到上次创建的项目：正常创建，并核销旧记录', async () => {
    sessionStorage.setItem('bw:home:latest-create-attempt', JSON.stringify({
      id: 'key-old',
      name: '2026-11-05 09:00',
      userId: 1,
      startedAt: Date.now() - 60_000,
      unsure: false,
      absent: false,
      state: null,
    }));

    await renderEntry();
    await act(async () => {
      canvasButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.createProject).toHaveBeenCalledTimes(1);
  });

  it('创建成功后核销最新尝试，再次点击会重新创建', async () => {
    await renderEntry();
    await act(async () => {
      canvasButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.navigate).toHaveBeenCalledWith('/canvas?project=42');
    expect(sessionStorage.getItem('bw:home:latest-create-attempt')).toBeNull();
  });
});
