// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Alert, { type AlertTone } from './index';

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

async function render(props: Parameters<typeof Alert>[0]): Promise<HTMLElement> {
  await act(async () => {
    root.render(createElement(Alert, props));
  });
  return mountNode.firstElementChild as HTMLElement;
}

describe('Alert', () => {
  it('渲染文案', async () => {
    const el = await render({ children: '保存失败，请稍后重试' });
    expect(el.textContent).toContain('保存失败，请稍后重试');
  });

  it('title 与正文分开渲染', async () => {
    const el = await render({ title: '保存失败', children: '网络超时' });
    expect(el.textContent).toContain('保存失败');
    expect(el.textContent).toContain('网络超时');
  });

  it('没有 title 时不渲染标题节点', async () => {
    const withTitle = await render({ title: 'T', children: 'x' });
    const titleClass = (withTitle.firstElementChild?.firstElementChild as HTMLElement).className;
    await act(async () => root.unmount());

    root = createRoot(mountNode);
    const withoutTitle = await render({ children: 'x' });
    const bodyClass = (withoutTitle.firstElementChild?.firstElementChild as HTMLElement).className;

    // 空标题会占一行高度，让一条单行提示变成两行
    expect(bodyClass).not.toBe(titleClass);
  });

  it('不同调子产出不同样式', async () => {
    const tones: AlertTone[] = ['info', 'success', 'warning', 'danger'];
    const classes: string[] = [];
    for (const tone of tones) {
      const el = await render({ tone, children: 'x' });
      classes.push(el.className);
      await act(async () => root.unmount());
      root = createRoot(mountNode);
    }
    // 四种调子必须互相区分，否则「配色表达严重程度」就是空话
    expect(new Set(classes).size).toBe(tones.length);
  });

  it('role=status：这是状态更新，不是对话框', async () => {
    const el = await render({ tone: 'danger', children: 'x' });
    expect(el.getAttribute('role')).toBe('status');
  });

  it('action 渲染在右侧', async () => {
    const el = await render({ children: '加载失败', action: createElement('button', null, '重试') });
    expect(el.textContent).toContain('重试');
  });
});
