// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginModal from './index';

let root: Root;
let mountNode: HTMLDivElement;

async function renderLoginModal(props: Partial<Parameters<typeof LoginModal>[0]> = {}) {
  const onClose = props.onClose ?? vi.fn();
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(LoginModal, { onClose, ...props }));
  });
  return { onClose };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('LoginModal shell', () => {
  it('通过共用 Modal 以 Portal 渲染登录面板', async () => {
    await renderLoginModal();

    expect(mountNode.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-semantic="mask"]')).not.toBeNull();
    expect(document.body.textContent).toContain('登录');
    expect(document.body.textContent).toContain('创建账号');
  });

  it('关闭按钮走统一 onCancel', async () => {
    const { onClose } = await renderLoginModal();

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('登录密码可在显示与隐藏状态之间切换', async () => {
    await renderLoginModal();
    const password = document.body.querySelector<HTMLInputElement>('input[placeholder="请输入密码"]');
    const toggle = document.body.querySelector<HTMLButtonElement>('button[aria-label="显示密码"]');

    expect(password?.type).toBe('password');

    await act(async () => toggle?.click());

    expect(password?.type).toBe('text');
    expect(document.body.querySelector('button[aria-label="隐藏密码"]')).not.toBeNull();
  });

  it('initialMode=register 时展示注册面板', async () => {
    await renderLoginModal({ initialMode: 'register' });

    expect(document.body.textContent).toContain('创建账号');
    expect(document.body.textContent).toContain('已有账号？返回登录');
    expect(document.body.querySelector('input[placeholder="账号（至少3位）"]')).not.toBeNull();
    expect(document.body.querySelector('input[placeholder="密码（8-20位）"]')).not.toBeNull();
  });
});
