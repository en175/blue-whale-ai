// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomeSidebar from './index';
import { MOCK_CANVAS_PROJECTS, MOCK_GENERATE_PROJECTS } from './mockHistoryProjects';

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

async function renderSidebar() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(HomeSidebar, { expanded: true, onExpandedChange: vi.fn() })));
  });
}

function items(): HTMLButtonElement[] {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('ul li > button[title]')];
}

function moreButtons(): HTMLButtonElement[] {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === '更多');
}

function searchBox(): HTMLInputElement {
  return mountNode.querySelector<HTMLInputElement>('input[aria-label="搜索项目"]')!;
}

async function typeSearch(value: string) {
  const input = searchBox();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('HomeSidebar 历史分组', () => {
  it('分「生成」「画布」两组，每组先显示 6 项', async () => {
    await renderSidebar();

    const headings = [...mountNode.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['生成', '画布']);
    expect(items()).toHaveLength(12);
    expect(items().slice(0, 6).map((b) => b.textContent)).toEqual(
      MOCK_GENERATE_PROJECTS.slice(0, 6).map((p) => p.name),
    );
  });

  it('「更多」每组每次只多追加 6 项', async () => {
    await renderSidebar();

    await act(async () => {
      moreButtons()[0].click();
    });
    expect(items()).toHaveLength(12 + 2);
    expect(items().slice(6, 8).map((b) => b.textContent)).toEqual(
      MOCK_GENERATE_PROJECTS.slice(6, 8).map((p) => p.name),
    );
  });

  it('搜索覆盖两组，换词重置已展开批次，无命中显示空态', async () => {
    await renderSidebar();

    await act(async () => {
      moreButtons()[0].click();
    });
    expect(items()).toHaveLength(14);

    await typeSearch('海报');
    expect(items().map((b) => b.textContent)).toEqual(MOCK_CANVAS_PROJECTS.filter((p) => p.name.includes('海报')).map((p) => p.name));

    await typeSearch('完全不存在的关键词');
    expect(mountNode.textContent).toContain('没有匹配的项目');

    await typeSearch('');
    expect(items()).toHaveLength(12);
  });

  it('点假数据不跳转到不存在的项目', async () => {
    await renderSidebar();

    await act(async () => {
      items()[0].click();
    });
    expect(toast.showToast).toHaveBeenCalledTimes(1);
  });
});
