// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RechargeModal from './index';

let root: Root;
let mountNode: HTMLDivElement;

async function renderRechargeModal() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(RechargeModal, { onClose: vi.fn() }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('RechargeModal', () => {
  it('通过共享 Modal 以 Portal 渲染', async () => {
    await renderRechargeModal();

    expect(mountNode.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-semantic="mask"]')).not.toBeNull();
    expect(document.body.textContent).toContain('积分充值');
  });

  it('明确告知充值暂未开放，不留点了没反应的按钮', async () => {
    await renderRechargeModal();

    expect(document.body.textContent).toContain('充值功能暂未开放');
    // 支付通道没有，就不该出现任何可点的档位 / 支付控件
    expect(document.body.querySelectorAll('button[class*="planCard"]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('确认支付');
    expect(document.body.textContent).not.toContain('微信支付');
  });
});
