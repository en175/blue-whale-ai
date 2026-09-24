// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Badge from './index';

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

async function render(props: Record<string, unknown>): Promise<HTMLElement> {
  await act(async () => {
    root.render(createElement(Badge, props));
  });
  return mountNode.firstElementChild as HTMLElement;
}

describe('Badge', () => {
  it('渲染内容', async () => {
    const badge = await render({ children: '正常' });
    expect(badge.textContent).toBe('正常');
  });

  it('默认不加色点', async () => {
    const badge = await render({ children: '正常' });
    // 色点是给「状态」用的；纯分类标签加上它就是噪声
    expect(badge.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it('dot 时渲染一个对读屏隐藏的装饰圆点', async () => {
    const badge = await render({ dot: true, children: '正常' });

    const dot = badge.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    // 圆点只是视觉强化，状态已由文字表达——必须对辅助技术隐藏，
    // 否则读屏会念出一个没有意义的空元素。
    expect(badge.textContent).toBe('正常');
  });

  it('不同调子产出不同样式', async () => {
    const ok = await render({ tone: 'success', children: '正常' });
    const okClass = ok.className;
    await act(async () => root.unmount());

    root = createRoot(mountNode);
    const danger = await render({ tone: 'danger', children: '已冻结' });

    expect(danger.className).not.toBe(okClass);
  });
});
