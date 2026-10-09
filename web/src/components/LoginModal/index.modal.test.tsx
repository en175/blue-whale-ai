// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendCode } from '@/api/auth';
import {
  PLATFORM_PRIVACY_POLICY_HREF,
  USER_SERVICES_AGREEMENT_HREF,
} from './agreements';
import LoginModal from './index';

vi.mock('@/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/auth')>();
  return {
    ...actual,
    sendCode: vi.fn(async () => null),
    loginWithPassword: vi.fn(),
    loginWithCode: vi.fn(),
    fetchMe: vi.fn(async () => null),
  };
});

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

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === text,
    ) ?? null
  );
}

function agreementCheckbox(): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>('input[type="checkbox"]');
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(sendCode).mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('LoginModal（IKJA4R 账号密码 / 手机号验证码 双态）', () => {
  it('通过共用 Modal 以 Portal 渲染，默认是账号密码态', async () => {
    await renderLoginModal();

    expect(mountNode.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-semantic="mask"]')).not.toBeNull();
    expect(document.body.querySelector('input[placeholder="请输入账号"]')).not.toBeNull();
    expect(document.body.querySelector('input[placeholder="请输入密码"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('创建账号');
  });

  it('关闭按钮走统一 onCancel', async () => {
    const { onClose } = await renderLoginModal();

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('密码可在显示与隐藏状态之间切换', async () => {
    await renderLoginModal();
    const password = document.body.querySelector<HTMLInputElement>('input[placeholder="请输入密码"]');
    const toggle = document.body.querySelector<HTMLButtonElement>('button[aria-label="显示密码"]');

    expect(password?.type).toBe('password');
    expect(toggle?.querySelector('svg.lucide-eye-off')).not.toBeNull();

    await act(async () => toggle?.click());

    expect(password?.type).toBe('text');
    expect(document.body.querySelector('button[aria-label="隐藏密码"]')).not.toBeNull();
  });

  it('「其他登录方式」原地切到手机号态，并能切回来', async () => {
    await renderLoginModal();

    await act(async () => buttonByText('手机号登录')?.click());

    expect(document.body.querySelector('input[placeholder="请输入手机号"]')).not.toBeNull();
    expect(document.body.querySelector('input[placeholder="请输入验证码"]')).not.toBeNull();
    expect(buttonByText('发送验证码')).not.toBeNull();
    expect(document.body.querySelector('input[placeholder="请输入账号"]')).toBeNull();

    await act(async () => buttonByText('账号密码登录')?.click());

    expect(document.body.querySelector('input[placeholder="请输入账号"]')).not.toBeNull();
    expect(document.body.querySelector('input[placeholder="请输入手机号"]')).toBeNull();
  });

  it('手机号态：号码不合法时「发送验证码」禁用，合法后可用', async () => {
    await renderLoginModal({ initialMode: 'phone' });

    const phoneInput = document.body.querySelector<HTMLInputElement>('input[placeholder="请输入手机号"]')!;
    expect(buttonByText('发送验证码')?.disabled).toBe(true);

    for (const bad of ['12345', '23800001234', '1380000123']) {
      await act(async () => setInputValue(phoneInput, bad));
      expect(buttonByText('发送验证码')?.disabled).toBe(true);
    }

    await act(async () => setInputValue(phoneInput, '13800001234'));
    expect(buttonByText('发送验证码')?.disabled).toBe(false);
  });

  it('手机号态：点一次「发送验证码」后进 60 秒冷却，且请求只发一次', async () => {
    await renderLoginModal({ initialMode: 'phone' });
    const phoneInput = document.body.querySelector<HTMLInputElement>('input[placeholder="请输入手机号"]')!;

    await act(async () => setInputValue(phoneInput, '13800001234'));
    await act(async () => buttonByText('发送验证码')?.click());

    expect(sendCode).toHaveBeenCalledWith('13800001234');
    expect(buttonByText('60 秒后重发')?.disabled).toBe(true);

    await act(async () => buttonByText('60 秒后重发')?.click());
    expect(sendCode).toHaveBeenCalledTimes(1);
  });

  it('★ 协议未勾选时，两个态的登录按钮都点不动', async () => {
    await renderLoginModal();
    const accountInput = document.body.querySelector<HTMLInputElement>('input[placeholder="请输入账号"]')!;
    const passwordInput = document.body.querySelector<HTMLInputElement>('input[placeholder="请输入密码"]')!;
    await act(async () => {
      setInputValue(accountInput, 'alice');
      setInputValue(passwordInput, 'secret');
    });
    expect(buttonByText('登录')?.disabled).toBe(true);

    await act(async () => agreementCheckbox()?.click());
    expect(buttonByText('登录')?.disabled).toBe(false);

    await act(async () => buttonByText('手机号登录')?.click());
    await act(async () => agreementCheckbox()?.click());
    const phoneInput = document.body.querySelector<HTMLInputElement>('input[placeholder="请输入手机号"]')!;
    const codeInput = document.body.querySelector<HTMLInputElement>('input[placeholder="请输入验证码"]')!;
    await act(async () => {
      setInputValue(phoneInput, '13800001234');
      setInputValue(codeInput, '123456');
    });
    expect(buttonByText('登录')?.disabled).toBe(true);
  });

  it('协议链接在当前态可用（两个态都渲染同一份）', async () => {
    await renderLoginModal();

    for (const mode of ['password', 'phone'] as const) {
      if (mode === 'phone') {
        await act(async () => buttonByText('手机号登录')?.click());
      }
      const links = Array.from(document.body.querySelectorAll<HTMLAnchorElement>('a'));
      expect(links.map((link) => link.textContent)).toEqual(['《用户协议》', '《隐私政策》']);
      expect(links.map((link) => link.href)).toEqual([
        USER_SERVICES_AGREEMENT_HREF,
        PLATFORM_PRIVACY_POLICY_HREF,
      ]);
      expect(links.every((link) => link.target === '_blank' && link.rel === 'noreferrer')).toBe(true);
    }
  });
});
