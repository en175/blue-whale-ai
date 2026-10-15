// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Tabs from './index';

let root: Root;
let mountNode: HTMLDivElement;

function Harness({
  disabledKey,
}: {
  disabledKey?: string;
}) {
  const [value, setValue] = useState('one');
  return createElement(Tabs, {
    value,
    onChange: setValue,
    ariaLabel: '示例',
    items: [
      { key: 'one', label: '一' },
      { key: 'two', label: '二', disabled: disabledKey === 'two' },
      { key: 'three', label: '三' },
    ],
  });
}

async function render(disabledKey?: string) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(Harness, { disabledKey }));
  });
}

function tabs(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('Tabs', () => {
  it('点击切换选中项', async () => {
    await render();
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      tabs()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[0].getAttribute('aria-selected')).toBe('false');
  });

  it('左右方向键切换', async () => {
    await render();
    await act(async () => { tabs()[0].focus(); });
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('禁用项不可选', async () => {
    await render('two');
    expect(tabs()[1].disabled).toBe(true);
    await act(async () => {
      tabs()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
  });
});
