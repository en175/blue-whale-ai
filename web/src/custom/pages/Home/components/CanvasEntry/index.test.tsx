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
  navigate: vi.fn(),
}));

vi.mock('@/custom/api/projects', async () => {
  const actual = await vi.importActual<typeof import('@/custom/api/projects')>('@/custom/api/projects');
  return { ...actual, createProject: api.createProject, fetchRecentProjects: api.fetchRecentProjects };
});
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => api.navigate };
});
vi.mock('@/shared/utils/auth', () => ({ getCurrentUser: () => ({ id: 'u1' }) }));
vi.mock('@/custom/components/LoginModal', () => ({ default: () => null }));

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
  api.createProject.mockResolvedValue(record('42', 'new'));
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
    expect(api.createProject).toHaveBeenCalledWith(expect.any(String), undefined, 'canvas');
    expect(api.navigate).toHaveBeenCalledWith('/canvas?project=42');
  });
});
