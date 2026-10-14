// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Skeleton from './index';

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe('Skeleton', () => {
  it('透传 DOM 属性和自定义样式类，并对辅助技术隐藏', async () => {
    await act(async () => {
      root.render(
        createElement(Skeleton, {
          className: 'custom-skeleton',
          style: { width: 120 },
          id: 'skeleton-under-test',
        }),
      );
    });

    const skeleton = mountNode.querySelector('#skeleton-under-test') as HTMLElement;
    expect(skeleton.classList).toContain('custom-skeleton');
    expect(skeleton.style.width).toBe('120px');
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
  });
});
