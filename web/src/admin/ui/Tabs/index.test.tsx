// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tabs from './index';

const ITEMS = [
  { key: 'all', label: '全部', count: 12 },
  { key: 'active', label: '进行中' },
  { key: 'done', label: '已完成', count: 3 },
];

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

async function render(props: Partial<Parameters<typeof Tabs>[0]> = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(Tabs, { items: ITEMS, value: 'all', onChange: () => {}, ...props }));
  });
}

function tab(label: string): HTMLElement {
  const found = Array.from(mountNode.querySelectorAll<HTMLElement>('[role="tab"]')).find(
    (element) => element.textContent?.startsWith(label),
  );
  if (!found) throw new Error(`找不到标签页：${label}`);
  return found;
}

async function press(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  });
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Tabs', () => {
  it('role=tablist / role=tab + aria-selected 表达选中态', async () => {
    await render();
    expect(mountNode.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tab('全部').getAttribute('aria-selected')).toBe('true');
    expect(tab('进行中').getAttribute('aria-selected')).toBe('false');
  });

  it('count 仍渲染在标签内', async () => {
    await render();
    expect(tab('全部').textContent).toContain('12');
    expect(tab('已完成').textContent).toContain('3');
  });

  it('点击标签回调 onChange', async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await act(async () => {
      tab('进行中').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(onChange).toHaveBeenCalledWith('active');
  });

  it('★ 方向键切换 —— 键盘用户不能只能靠鼠标换页', async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await press(tab('全部'), 'ArrowRight');
    expect(onChange).toHaveBeenCalledWith('active');
    expect(document.activeElement).toBe(tab('进行中'));
  });

  it('方向键到头后回环', async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await press(tab('全部'), 'ArrowLeft');
    expect(onChange).toHaveBeenCalledWith('done');
  });
});
