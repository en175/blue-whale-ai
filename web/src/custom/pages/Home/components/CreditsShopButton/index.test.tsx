// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore, type SessionUser } from '@/shared/stores/auth';
import { useRechargeUiStore } from '@/custom/stores/recharge';
import CreditsShopButton from './index';

const USER: SessionUser = {
  userId: 1,
  username: 'alice',
  nickname: 'alice',
  email: '',
  phone: '',
  hasPassword: true,
  isAdmin: false,
};

let root: Root;
let mountNode: HTMLDivElement;

async function renderButton() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(CreditsShopButton));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useAuthStore.setState({ user: null });
  useRechargeUiStore.getState().closeRecharge();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('CreditsShopButton', () => {
  it('未登录时不渲染入口', async () => {
    await renderButton();

    expect(mountNode.innerHTML).toBe('');
  });

  it('登录后展示铜钱图标（外圆内方）与「积分超市」文案', async () => {
    useAuthStore.setState({ user: USER });
    await renderButton();

    expect(mountNode.querySelector('button')?.textContent).toBe('积分超市');
    const svg = mountNode.querySelector('svg');
    expect(svg?.querySelector('circle')).not.toBeNull();
    expect(svg?.querySelector('rect')).not.toBeNull();
  });

  it('点击后打开积分充值弹窗开关', async () => {
    useAuthStore.setState({ user: USER });
    await renderButton();

    await act(async () => {
      mountNode.querySelector('button')?.click();
    });

    expect(useRechargeUiStore.getState().open).toBe(true);
  });
});
