// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicHomepageHeroes } from '@/shared/api/homepageHeroes';
import {
  bindMigrationPhone,
  fetchCaptcha,
  loginWithCode,
  sendCode,
  verifyMigrationPassword,
} from '@/custom/api/auth';
import {
  PLATFORM_PRIVACY_POLICY_HREF,
  USER_SERVICES_AGREEMENT_HREF,
} from './agreements';
import { toast } from '@/shared/components/Toast';
import LoginModal from './index';
import styles from './index.module.css';

vi.mock('@/shared/components/Toast', () => ({
  showToast: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/shared/api/homepageHeroes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/homepageHeroes')>();
  return {
    ...actual,
    fetchPublicHomepageHeroes: vi.fn(async () => []),
  };
});

vi.mock('@/custom/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/custom/api/auth')>();
  return {
    ...actual,
    fetchCaptcha: vi.fn(async () => ({ id: 'cap_1', image: 'data:image/png;base64,aa', expires_in: 60 })),
    sendCode: vi.fn(async () => null),
    loginWithCode: vi.fn(),
    verifyMigrationPassword: vi.fn(),
    bindMigrationPhone: vi.fn(),
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(LoginModal, { onClose, ...props }),
      ),
    );
  });
  return { onClose };
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === text,
    ) ?? null
  );
}

function inputByPlaceholder(placeholder: string): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.mocked(fetchCaptcha).mockClear();
  vi.mocked(sendCode).mockClear();
  vi.mocked(loginWithCode).mockClear();
  vi.mocked(verifyMigrationPassword).mockClear();
  vi.mocked(bindMigrationPhone).mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  localStorage.clear();
});

describe('LoginModal 手机号登录', () => {
  it('弹出双栏手机号登录，不再展示账号密码和注册表单', async () => {
    await renderLoginModal();

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('欢迎来到蓝鲸');
    expect(document.body.textContent).toContain('手机号验证通过后即可登录，未注册将自动创建账号。');
    expect(inputByPlaceholder('请输入手机号')).not.toBeNull();
    expect(inputByPlaceholder('请输入验证码')).not.toBeNull();
    expect(buttonByText('获取验证码')).not.toBeNull();
    expect(buttonByText('登录')).not.toBeNull();
    expect(buttonByText('内部老账号迁移↗')).not.toBeNull();
    expect(inputByPlaceholder('请输入账号')).toBeNull();
    expect(buttonByText('创建账号')).toBeNull();
    expect(document.body.querySelector('a[href="' + USER_SERVICES_AGREEMENT_HREF + '"]')).not.toBeNull();
    expect(document.body.querySelector('a[href="' + PLATFORM_PRIVACY_POLICY_HREF + '"]')).not.toBeNull();
  });

  it('未勾选协议时不提交登录', async () => {
    await renderLoginModal();
    const phone = inputByPlaceholder('请输入手机号');
    const code = inputByPlaceholder('请输入验证码');
    expect(phone).not.toBeNull();
    expect(code).not.toBeNull();
    await act(async () => {
      setInputValue(phone!, '13800001234');
      setInputValue(code!, '123456');
    });
    await act(async () => {
      buttonByText('登录')?.click();
    });
    expect(loginWithCode).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('请先阅读并同意用户服务协议和隐私政策');
  });

  it('获取验证码先取图形验证码，填入后再按登录用途发送', async () => {
    await renderLoginModal();
    const phone = inputByPlaceholder('请输入手机号');
    const sendButton = buttonByText('获取验证码');
    expect(sendButton?.className).toBe(styles.textAction);
    await act(async () => setInputValue(phone!, '13800001234'));
    expect(buttonByText('获取验证码')?.className).toBe(styles.codeActionReady);
    await act(async () => buttonByText('获取验证码')?.click());
    expect(fetchCaptcha).toHaveBeenCalledWith('13800001234', 'login');
    expect(sendCode).not.toHaveBeenCalled();
    expect(document.body.querySelector('[aria-label="安全验证"] h2')?.textContent).toBe('安全验证');
    expect(document.body.textContent).not.toContain('内部老账号迁移');

    await act(async () => buttonByText('← 返回')?.click());
    expect(document.body.querySelector('[aria-label="安全验证"]')).toBeNull();
    expect(document.body.textContent).toContain('欢迎来到蓝鲸');

    await act(async () => buttonByText('获取验证码')?.click());
    const captcha = inputByPlaceholder('请输入图中字符');
    expect(captcha).not.toBeNull();
    await act(async () => setInputValue(captcha!, 'ab2c'));
    expect(sendCode).toHaveBeenCalledWith({
      phone: '13800001234',
      purpose: 'login',
      captchaId: 'cap_1',
      captchaAnswer: 'ab2c',
    });
    expect(buttonByText('60秒后重发')?.className).toBe(styles.codeActionCooldown);
    expect(toast).toHaveBeenCalledWith('验证码已发送，5分钟内有效');
    expect(document.body.querySelector('[aria-label="安全验证"]')).toBeNull();
    expect(document.body.textContent).toContain('内部老账号迁移');
  });

  it('手机号格式不正确时不取图形验证码', async () => {
    await renderLoginModal();
    const phone = inputByPlaceholder('请输入手机号');
    await act(async () => setInputValue(phone!, '12345'));
    await act(async () => buttonByText('获取验证码')?.click());
    expect(fetchCaptcha).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('请输入正确的手机号');
  });
});

describe('LoginModal 内部老账号迁移', () => {
  it('从底部入口进入验证原账号，并可返回手机号登录', async () => {
    await renderLoginModal();
    await act(async () => buttonByText('内部老账号迁移↗')?.click());
    expect(document.body.textContent).toContain('内部老账号迁移');
    expect(inputByPlaceholder('请输入原账号')).not.toBeNull();
    expect(inputByPlaceholder('请输入原密码')).not.toBeNull();
    expect(buttonByText('验证原账号')).not.toBeNull();

    await act(async () => buttonByText('← 返回手机号登录')?.click());
    expect(document.body.textContent).toContain('欢迎来到蓝鲸');
  });

  it('原账号验证通过后进入绑定手机号', async () => {
    vi.mocked(verifyMigrationPassword).mockResolvedValueOnce({
      migration_token: 'mig_1',
      expires_in: 600,
    });
    await renderLoginModal();
    await act(async () => buttonByText('内部老账号迁移↗')?.click());
    expect(buttonByText('验证原账号')?.className).not.toContain(styles.submitReady);
    const username = inputByPlaceholder('请输入原账号');
    const password = inputByPlaceholder('请输入原密码');
    await act(async () => {
      setInputValue(username!, 'old_user');
      setInputValue(password!, 'secret');
    });
    expect(buttonByText('验证原账号')?.className).toContain(styles.submitReady);
    await act(async () => buttonByText('验证原账号')?.click());

    expect(verifyMigrationPassword).toHaveBeenCalledWith('old_user', 'secret');
    expect(document.body.textContent).toContain('绑定手机号');
    expect(document.body.textContent).toContain('完成绑定后进入原账号，项目和素材将保留');
    expect(buttonByText('绑定并进入原账号')).not.toBeNull();
    expect(buttonByText('取消迁移，返回登录')).not.toBeNull();
  });
});

describe('LoginModal 左侧背景', () => {
  it('先展示首帧，视频加载成功后再切到视频', async () => {
    vi.mocked(fetchPublicHomepageHeroes).mockResolvedValueOnce([
      {
        id: '7',
        media_type: 'video',
        media_url: 'https://cdn.example.com/auth.mp4',
        poster_url: 'https://cdn.example.com/auth.jpg',
        sort_order: 0,
      },
    ]);
    await renderLoginModal();
    await act(async () => {
      await vi.waitFor(() => {
        expect(document.body.querySelector('img[src="https://cdn.example.com/auth.jpg"]')).not.toBeNull();
      });
    });

    const poster = document.body.querySelector<HTMLImageElement>('img[src="https://cdn.example.com/auth.jpg"]');
    const video = document.body.querySelector<HTMLVideoElement>('video[src="https://cdn.example.com/auth.mp4"]');
    expect(poster?.className).toBe(styles.mediaFill);
    expect(video).not.toBeNull();
    expect(video?.preload).toBe('auto');
    expect(video?.className).toBe(styles.mediaPreload);

    await act(async () => {
      video?.dispatchEvent(new Event('loadeddata'));
    });
    expect(poster?.className).toBe(styles.mediaHidden);
    expect(video?.className).toBe(styles.mediaFill);
  });
});
