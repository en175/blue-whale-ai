// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RatioGroup from './index';

let root: Root;
let mountNode: HTMLDivElement;

function Harness() {
  const [value, setValue] = useState('1:1');
  return createElement(RatioGroup, {
    value,
    onChange: setValue,
    ariaLabel: '宽高比',
    options: [
      { value: '1:1', label: '1:1' },
      { value: '16:9', label: '16:9' },
    ],
  });
}

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

describe('RatioGroup', () => {
  it('灰底选中且点击切换取值，不允许点空', async () => {
    await act(async () => {
      root.render(createElement(Harness));
    });
    const buttons = [...mountNode.querySelectorAll<HTMLButtonElement>('[data-testid="ratio-group"] button')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('data-state')).toBe('on');
    expect(getComputedStyle(buttons[0]).backgroundColor).not.toMatch(/rgb\(61,\s*90,\s*254\)/);
    await act(async () => { buttons[1].click(); });
    expect(buttons[1].getAttribute('data-state')).toBe('on');
    await act(async () => { buttons[1].click(); });
    expect(buttons[1].getAttribute('data-state')).toBe('on');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });
});
