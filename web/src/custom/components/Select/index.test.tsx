// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Select from './index';

let root: Root;
let mountNode: HTMLDivElement;

function Harness() {
  const [value, setValue] = useState('alpha');
  return createElement(Select, {
    value,
    onChange: setValue,
    ariaLabel: '示例选择',
    options: [
      { value: 'alpha', label: '甲' },
      { value: 'beta', label: '乙' },
    ],
  });
}

async function render() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(Harness));
  });
}

function options(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('Select', () => {
  it('未选中选项也保留对号占位且不挤文字', async () => {
    await render();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[role="combobox"]')?.click();
    });

    const items = options();
    expect(items).toHaveLength(2);
    const slots = items.map((item) => item.querySelector('[data-selected]'));
    expect(slots.every((slot) => slot != null)).toBe(true);

    const selected = items.find((item) => item.getAttribute('data-state') === 'checked');
    const idle = items.find((item) => item.getAttribute('data-state') !== 'checked');
    expect(selected?.querySelector('[data-selected]')?.getAttribute('data-selected')).toBe('true');
    expect(idle?.querySelector('[data-selected]')?.getAttribute('data-selected')).toBe('false');
  });
});
