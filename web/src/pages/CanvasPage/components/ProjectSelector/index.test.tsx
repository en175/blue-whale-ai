// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectSelector, { type CanvasProject } from './index';
import styles from './index.module.css';

/* 悬停显隐由 CSS（.projectItem:hover .pinBtn）控制，jsdom 无法驱动 :hover；
 * 用例只断言按钮在 DOM 中渲染且语义（title/顺序/回调）正确，视觉显隐交 CSS 实现。 */

const projects: CanvasProject[] = [
  { id: 'p1', name: '已置顶项目', pinned: true },
  { id: 'p2', name: '普通项目' },
];

const selectorProps = {
  projects,
  currentId: 'p2',
  onSelect: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onTogglePin: vi.fn(),
  onNewProject: vi.fn(),
};

let root: Root;
let mountNode: HTMLDivElement;

async function renderSelector(overrides: Partial<typeof selectorProps> = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(ProjectSelector, { ...selectorProps, ...overrides }));
  });
}

async function openDropdown() {
  const trigger = mountNode.querySelector<HTMLButtonElement>(`.${styles.trigger}`);
  if (!trigger) throw new Error('触发按钮未渲染');
  await act(async () => { trigger.click(); });
}

function pinButtons(): HTMLButtonElement[] {
  return [...mountNode.querySelectorAll<HTMLButtonElement>(`.${styles.pinBtn}`)];
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('ProjectSelector 置顶入口（IKH1YL）', () => {
  it('下拉展开后每个项目行渲染置顶按钮，两态 title 随置顶状态切换', async () => {
    await renderSelector();
    await openDropdown();

    const buttons = pinButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.title).toBe('取消置顶');
    expect(buttons[1]?.title).toBe('置顶');
  });

  it('置顶按钮渲染在删除按钮左侧', async () => {
    await renderSelector();
    await openDropdown();

    const item = mountNode.querySelector<HTMLDivElement>(`.${styles.projectItem}`);
    expect(item?.querySelector(`.${styles.pinBtn}`)?.nextElementSibling?.className)
      .toContain(styles.deleteBtn);
  });

  it('点击未置顶项目的置顶按钮回调 (id, true)，不触发选中，下拉保持展开', async () => {
    await renderSelector();
    await openDropdown();

    const buttons = pinButtons();
    await act(async () => { buttons[1]?.click(); });

    expect(selectorProps.onTogglePin).toHaveBeenCalledWith('p2', true);
    expect(selectorProps.onSelect).not.toHaveBeenCalled();
    expect(mountNode.querySelector(`.${styles.dropdown}`)).not.toBeNull();
  });

  it('点击已置顶项目的取消置顶按钮回调 (id, false)', async () => {
    await renderSelector();
    await openDropdown();

    const buttons = pinButtons();
    await act(async () => { buttons[0]?.click(); });

    expect(selectorProps.onTogglePin).toHaveBeenCalledWith('p1', false);
    expect(selectorProps.onSelect).not.toHaveBeenCalled();
  });

  it('置顶项目行常显图钉标记，未置顶项目没有', async () => {
    await renderSelector();
    await openDropdown();

    const items = [...mountNode.querySelectorAll<HTMLDivElement>(`.${styles.projectItem}`)];
    expect(items[0]?.querySelector(`.${styles.pinnedIcon}`)).not.toBeNull();
    expect(items[1]?.querySelector(`.${styles.pinnedIcon}`)).toBeNull();
  });

  it('未提供 onTogglePin 时点击置顶按钮不报错', async () => {
    await renderSelector({ onTogglePin: undefined });
    await openDropdown();

    const buttons = pinButtons();
    await act(async () => { buttons[1]?.click(); });

    expect(selectorProps.onSelect).not.toHaveBeenCalled();
    expect(mountNode.querySelector(`.${styles.dropdown}`)).not.toBeNull();
  });
});
