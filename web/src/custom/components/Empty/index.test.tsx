// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Empty from './index';

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

describe('Empty', () => {
  it('渲染标题、说明和操作按钮', async () => {
    const onClick = vi.fn();
    await act(async () => {
      root.render(
        createElement(Empty, {
          title: '暂无素材',
          description: '换个关键词试试',
          action: createElement('button', { type: 'button', onClick }, '重新加载'),
        }),
      );
    });
    expect(mountNode.textContent).toContain('暂无素材');
    expect(mountNode.textContent).toContain('换个关键词试试');
    const button = mountNode.querySelector('button')!;
    await act(async () => { button.click(); });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
