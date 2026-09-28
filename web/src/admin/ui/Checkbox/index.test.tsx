// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Checkbox from './index';

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

async function render(props: Parameters<typeof Checkbox>[0]): Promise<HTMLElement> {
  await act(async () => {
    root.render(createElement(Checkbox, props));
  });
  return mountNode.firstElementChild as HTMLElement;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('Checkbox', () => {
  it('★ 不用原生 input —— 原生控件跟随系统深色模式，会渲染成突兀的深色方块', async () => {
    const el = await render({ checked: false, onChange: vi.fn() });
    expect(el.tagName).toBe('SPAN');
    expect(el.querySelector('input')).toBeNull();
  });

  it('role=checkbox + aria-checked 表达状态', async () => {
    const off = await render({ checked: false, onChange: vi.fn() });
    expect(off.getAttribute('role')).toBe('checkbox');
    expect(off.getAttribute('aria-checked')).toBe('false');
  });

  it('点击回调传的是取反后的值', async () => {
    const onChange = vi.fn();
    const el = await render({ checked: false, onChange });
    await click(el);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('已选中时点击传 false', async () => {
    const onChange = vi.fn();
    const el = await render({ checked: true, onChange });
    await click(el);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('★ disabled 时不回调 —— 灰掉的控件仍然响应点击是最容易被忽略的一种「能点但没用」', async () => {
    const onChange = vi.fn();
    const el = await render({ checked: false, onChange, disabled: true });
    await click(el);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('键盘空格也能切换（不能只有鼠标能用）', async () => {
    const onChange = vi.fn();
    const el = await render({ checked: false, onChange });
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('★ indeterminate 走 aria-checked=mixed，而不是 checked=true', async () => {
    // 「部分选中」当成「全选」会让读屏用户以为整页都选上了
    const el = await render({ checked: false, indeterminate: true, onChange: vi.fn() });
    expect(el.getAttribute('aria-checked')).toBe('mixed');
  });

  it('有 label 时整行可点，无 label 时只点方框', async () => {
    const withLabel = await render({ checked: false, onChange: vi.fn(), label: '全选' });
    expect(withLabel.tagName).toBe('LABEL');
    expect(withLabel.textContent).toContain('全选');
    await act(async () => root.unmount());
    root = createRoot(mountNode);
    const noLabel = await render({ checked: false, onChange: vi.fn(), 'aria-label': '选这一行' });
    expect(noLabel.tagName).toBe('SPAN');
    // 没有可见文案时必须有 aria-label，否则读屏只念出一个「复选框」
    expect(noLabel.getAttribute('aria-label')).toBe('选这一行');
  });

  it('★ 点 label 文字也切换（且只切一次）', async () => {
    // `<span role="checkbox">` 不是 labelable 元素，浏览器不会把「点文字」转发给它 ——
    // 只把 onClick 挂在方框上时，点「周一」这两个字没有任何反应，而用户几乎总是点文字
    const onChange = vi.fn();
    const el = await render({ checked: false, onChange, label: '周一' });
    await click(el.querySelector('span:last-child') as Element);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('★ 点方框只切换一次（不能因为冒泡到 label 而切两次）', async () => {
    const onChange = vi.fn();
    const el = await render({ checked: false, onChange, label: '周一' });
    await click(el.querySelector('[role="checkbox"]') as Element);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
