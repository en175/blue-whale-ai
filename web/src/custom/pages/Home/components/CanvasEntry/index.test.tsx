// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasEntry from './index';
import { MOCK_RECENT_CANVASES } from './mockRecentCanvases';

const api = vi.hoisted(() => ({ createProject: vi.fn(), navigate: vi.fn() }));

vi.mock('@/custom/api/projects', () => ({ createProject: api.createProject }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => api.navigate };
});
vi.mock('@/shared/utils/auth', () => ({ getCurrentUser: () => ({ id: 'u1' }) }));
vi.mock('@/custom/components/LoginModal', () => ({ default: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;

async function renderEntry() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CanvasEntry)));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  api.createProject.mockResolvedValue({ id: 42, name: 'x' });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.clearAllMocks();
});

describe('CanvasEntry', () => {
  it('展示「新建画布」+ 3 个最近项目位，且没有「最近项目」标题', async () => {
    await renderEntry();

    expect(mountNode.textContent).toContain('新建画布');
    expect(mountNode.textContent).not.toContain('最近项目');
    expect(mountNode.querySelectorAll('[data-testid="canvas-recent-placeholder"]')).toHaveLength(3);
    MOCK_RECENT_CANVASES.slice(0, 3).forEach((item) => {
      expect(mountNode.textContent).toContain(item.name);
    });
  });

  it('点最近项目位不创建项目、不跳转', async () => {
    await renderEntry();

    await act(async () => {
      mountNode.querySelector<HTMLElement>('[data-testid="canvas-recent-placeholder"]')!.click();
    });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.navigate).not.toHaveBeenCalled();
  });

  it('新建画布在当前页进入空画布', async () => {
    await renderEntry();

    const button = [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.includes('新建画布'))!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.navigate).toHaveBeenCalledWith('/canvas?project=42');
  });
});
