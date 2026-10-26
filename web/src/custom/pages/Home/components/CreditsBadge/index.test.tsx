// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/shared/stores/auth';
import CreditsBadge from './index';

let root: Root;
let mountNode: HTMLDivElement;

async function renderBadge() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(CreditsBadge));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useAuthStore.setState({ credits: null });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('CreditsBadge', () => {
  it('余额未加载（null）时不渲染徽标', async () => {
    await renderBadge();

    expect(mountNode.innerHTML).toBe('');
  });

  it('展示千分位余额与黄色实心闪电', async () => {
    useAuthStore.setState({ credits: 12345 });
    await renderBadge();

    expect(mountNode.textContent).toBe('12,345');
    const svg = mountNode.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('#FBBF24');
    expect(svg?.getAttribute('stroke')).toBe('none');
    expect(svg?.children.length).toBeGreaterThan(0);
  });

  it('余额为 0 时照常展示（仅 null 才隐藏）', async () => {
    useAuthStore.setState({ credits: 0 });
    await renderBadge();

    expect(mountNode.textContent).toBe('0');
  });
});
