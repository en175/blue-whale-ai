// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Button from './index';

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

async function render(props: Record<string, unknown>): Promise<HTMLButtonElement> {
  await act(async () => {
    root.render(createElement(Button, props));
  });
  return mountNode.querySelector('button') as HTMLButtonElement;
}

describe('Button', () => {
  it('渲染文字并能点击', async () => {
    const onClick = vi.fn();
    const btn = await render({ onClick, children: '冻结' });

    await act(async () => btn.click());

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn.textContent).toBe('冻结');
  });

  it('★ type 默认是 button —— 放进表单里不会意外提交', async () => {
    const btn = await render({ children: '查询' });
    expect(btn.type).toBe('button');
  });

  it('显式传入的 type 不被覆盖', async () => {
    const btn = await render({ type: 'submit', children: '提交' });
    expect(btn.type).toBe('submit');
  });

  it('disabled 时不可点', async () => {
    const onClick = vi.fn();
    const btn = await render({ disabled: true, onClick, children: '删除' });

    await act(async () => btn.click());

    expect(btn.disabled).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('未知属性透传到原生元素', async () => {
    const btn = await render({ 'aria-label': '关闭弹窗', children: '×' });
    expect(btn.getAttribute('aria-label')).toBe('关闭弹窗');
  });

  it('图标与文字同时渲染', async () => {
    const btn = await render({
      icon: createElement('span', { 'data-testid': 'icon' }),
      children: '导出',
    });

    expect(btn.querySelector('[data-testid="icon"]')).not.toBeNull();
    expect(btn.textContent).toContain('导出');
  });
});
