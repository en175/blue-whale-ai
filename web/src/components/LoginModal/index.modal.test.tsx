// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLATFORM_PRIVACY_POLICY_HREF,
  USER_SERVICES_AGREEMENT_HREF,
} from './agreements';
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
    expect(toggle?.querySelector('svg.lucide-eye-off')).not.toBeNull();

    await act(async () => toggle?.click());

    expect(password?.type).toBe('text');
    expect(document.body.querySelector('button[aria-label="隐藏密码"]')).not.toBeNull();
    expect(document.body.querySelector('button[aria-label="隐藏密码"] svg.lucide-eye')).not.toBeNull();
  });

  it('initialMode=register 时展示注册面板', async () => {
    await renderLoginModal({ initialMode: 'register' });

    expect(document.body.textContent).toContain('创建账号');
    expect(document.body.textContent).toContain('已有账号？返回登录');
    expect(document.body.querySelector('input[placeholder="账号（至少3位）"]')).not.toBeNull();
    expect(document.body.querySelector('input[placeholder="密码（8 位以上）"]')).not.toBeNull();
  });

  it('注册密码与确认密码可用眼睛图标切换显示隐藏', async () => {
    await renderLoginModal({ initialMode: 'register' });

    const password = document.body.querySelector<HTMLInputElement>('input[placeholder="密码（8 位以上）"]');
    const confirm = document.body.querySelector<HTMLInputElement>('input[placeholder="确认密码"]');
    const passwordToggle = password?.parentElement?.querySelector<HTMLButtonElement>('button');
    const confirmToggle = confirm?.parentElement?.querySelector<HTMLButtonElement>('button');

    expect(password?.type).toBe('password');
    expect(confirm?.type).toBe('password');
    expect(passwordToggle).not.toBeNull();
    expect(confirmToggle).not.toBeNull();
    expect(passwordToggle?.getAttribute('aria-label')).toBe('显示密码');
    expect(confirmToggle?.getAttribute('aria-label')).toBe('显示确认密码');
    expect(passwordToggle?.querySelector('svg.lucide-eye-off')).not.toBeNull();
    expect(confirmToggle?.querySelector('svg.lucide-eye-off')).not.toBeNull();
    expect(passwordToggle?.textContent).not.toMatch(/显示|隐藏/);
    expect(confirmToggle?.textContent).not.toMatch(/显示|隐藏/);

    await act(async () => passwordToggle?.click());

    expect(password?.type).toBe('text');
    expect(confirm?.type).toBe('password');
    expect(passwordToggle?.getAttribute('aria-label')).toBe('隐藏密码');
    expect(passwordToggle?.querySelector('svg.lucide-eye:not(.lucide-eye-off)')).not.toBeNull();

    await act(async () => confirmToggle?.click());

    expect(confirm?.type).toBe('text');
    expect(confirmToggle?.getAttribute('aria-label')).toBe('隐藏确认密码');

    await act(async () => passwordToggle?.click());

    expect(password?.type).toBe('password');
    expect(passwordToggle?.getAttribute('aria-label')).toBe('显示密码');
  });

  it('登录和注册表单分别打开用户协议与隐私政策', async () => {
    await renderLoginModal();

    const expectedHrefs = [USER_SERVICES_AGREEMENT_HREF, PLATFORM_PRIVACY_POLICY_HREF];
    const loginLinks = Array.from(document.body.querySelectorAll<HTMLAnchorElement>('a'));
    expect(loginLinks.map((link) => link.textContent)).toEqual(['《用户协议》', '《隐私政策》']);
    expect(loginLinks.map((link) => link.href)).toEqual(expectedHrefs);
    for (const link of loginLinks) {
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noreferrer');
    }

    await act(async () => {
      root.render(createElement(LoginModal, { onClose: vi.fn(), initialMode: 'register' }));
    });

    const registerLinks = Array.from(document.body.querySelectorAll<HTMLAnchorElement>('a'));
    expect(registerLinks.map((link) => link.textContent)).toEqual(['《用户协议》', '《隐私政策》']);
    expect(registerLinks.map((link) => link.href)).toEqual(expectedHrefs);
    for (const link of registerLinks) {
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noreferrer');
    }
  });
});
