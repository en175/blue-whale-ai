// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Checkbox from './index';

let root: Root;
let mountNode: HTMLDivElement;

async function render(checked: boolean) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(Checkbox, { checked }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('Checkbox', () => {
  it('未选中也保留对号占位', async () => {
    await render(false);
    const slot = document.body.querySelector('[data-selected]');
    expect(slot).not.toBeNull();
    expect(slot?.getAttribute('data-selected')).toBe('false');
    expect(slot?.querySelector('svg')).not.toBeNull();
  });

  it('选中时对号槽标记为已选', async () => {
    await render(true);
    expect(document.body.querySelector('[data-selected]')?.getAttribute('data-selected')).toBe('true');
  });
});
