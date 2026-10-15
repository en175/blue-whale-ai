// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchInput from './index';

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

describe('SearchInput', () => {
  it('展示图标和 placeholder，并把输入值交给 onChange', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(createElement(SearchInput, { value: '', onChange, placeholder: '搜索资产' }));
    });
    const input = mountNode.querySelector('input[placeholder="搜索资产"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(mountNode.querySelector('svg')).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '猫');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('猫');
  });
});
