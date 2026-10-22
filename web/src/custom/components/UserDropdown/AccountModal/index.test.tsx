// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCaptcha, sendCode, updateNickname } from '@/custom/api/auth';
import { toast } from '@/shared/components/Toast';

vi.mock('@/shared/components/Toast', () => ({
  showToast: vi.fn(),
  toast: vi.fn(),
}));
import AccountModal from './index';
import rebindStyles from '../RebindPhoneModal/index.module.css';

const profile = {
  id: 11001,
  username: 'user',
  nickname: '蓝鲸用户_NACRQX',
  email: '',
  phone: '13900000009',
  avatar: null,
  created_at: '',
  has_password: false,
};

vi.mock('@/custom/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/custom/api/auth')>();
  const fetchMe = vi.fn(async () => profile);
  return {
    ...actual,
    fetchMe,
    accountProfileOptions: (userId: number) => ({
      ...actual.accountProfileOptions(userId),
      queryFn: () => fetchMe(),
    }),
    updateNickname: vi.fn(async (nickname: string) => ({ nickname, changed: true })),
    fetchCaptcha: vi.fn(async () => ({ id: 'cap_1', image: 'data:image/png;base64,aa', expires_in: 60 })),
    sendCode: vi.fn(async () => null),
    verifyCurrentPhoneForRebind: vi.fn(async () => ({ rebind_token: 'rebind-token', expires_in: 600 })),
    submitPhoneRebind: vi.fn(),
  };
});

vi.mock('../AccountRecordsModal', () => ({
  default: function MockAccountRecordsModal() {
    return null;
  },
}));

let root: Root;
let mountNode: HTMLDivElement;

async function renderAccountModal(onClose = vi.fn(), onRequireLogin = vi.fn()) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AccountModal, {
          userId: 1,
          nickname: 'alice',
          phone: '',
          hasPassword: true,
          balance: 0,
          onClose,
          onRequireLogin,
        }),
      ),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { onClose, onRequireLogin };
}

function buttonByText(text: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  );
}

function inputByPlaceholder(placeholder: string) {
  return document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchCaptcha).mockClear();
  vi.mocked(sendCode).mockClear();
  vi.mocked(updateNickname).mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

function nicknameInput() {
  return document.body.querySelector<HTMLInputElement>('input[aria-label="昵称"]');
}

async function waitForProfile() {
  await act(async () => {
    await vi.waitFor(() => {
      if (!document.body.textContent?.includes('蓝鲸用户_NACRQX')) throw new Error('账号资料尚未返回');
    });
  });
}

describe('AccountModal', () => {
  it('展示用户 ID、昵称、脱敏手机号和积分，不再提供改密或去充值', async () => {
    await renderAccountModal();
    await waitForProfile();

    expect(document.body.textContent).toContain('蓝鲸用户_NACRQX');
    expect(document.body.textContent).toContain('139 *** *** 0009');
    expect(document.body.textContent).not.toContain('11/20');
    expect(nicknameInput()).toBeNull();
    expect(buttonByText('修改')).toBeTruthy();
    expect(buttonByText('更换')).toBeTruthy();
    expect(buttonByText('账户记录')).toBeTruthy();
    expect(buttonByText('去充值')).toBeUndefined();
    expect(buttonByText('保存')).toBeUndefined();
  });

  it('点击修改后才进入昵称编辑，保存时提交修剪后的文本', async () => {
    await renderAccountModal();
    await waitForProfile();
    await act(async () => buttonByText('修改')?.click());
    const nickname = nicknameInput();
    expect(nickname).not.toBeNull();
    await act(async () => setInputValue(nickname!, ' 新昵称 '));
    await act(async () => buttonByText('保存')?.click());
    expect(updateNickname).toHaveBeenCalledWith('新昵称', expect.anything());
    expect(nicknameInput()).toBeNull();
    expect(document.body.textContent).toContain('新昵称');
  });

  it('保存时拒绝过短、过长、空格、符号和表情，不提交接口', async () => {
    await renderAccountModal();
    await waitForProfile();
    const rejected = ['a', 'a'.repeat(21), '含 空格', '昵称!', 'ok😀', '  '];

    for (const invalid of rejected) {
      vi.mocked(updateNickname).mockClear();
      if (!nicknameInput()) await act(async () => buttonByText('修改')?.click());
      await act(async () => setInputValue(nicknameInput()!, invalid));
      await act(async () => buttonByText('保存')?.click());
      expect(updateNickname).not.toHaveBeenCalled();
      expect(nicknameInput()?.getAttribute('aria-invalid')).toBe('true');
      expect(document.body.textContent).toContain(
        '2—20个字符，仅支持中文、英文大小写字母、数字、下划线（_）和短横线（-）。',
      );
      await act(async () => buttonByText('取消')?.click());
    }
  });

  it('更换手机号先做图形验证，通过后按原号用途发短信', async () => {
    await renderAccountModal();
    await waitForProfile();
    await act(async () => buttonByText('更换')?.click());

    expect(document.body.textContent).toContain('验证原手机号');
    expect(document.body.textContent).toContain('1 验证原号');
    expect(buttonByText('获取验证码')).toBeTruthy();
    expect(buttonByText('下一步')?.className).toBe(rebindStyles.submit);

    await act(async () => buttonByText('获取验证码')?.click());
    expect(fetchCaptcha).toHaveBeenCalledWith('13900000009', 'rebind_old');
    expect(document.body.querySelector('[aria-label="安全验证"] h2')?.textContent).toBe('安全验证');

    const captcha = inputByPlaceholder('请输入图中字符');
    expect(captcha).not.toBeNull();
    await act(async () => setInputValue(captcha!, 'ab2c'));
    expect(sendCode).toHaveBeenCalledWith({
      phone: '13900000009',
      purpose: 'rebind_old',
      captchaId: 'cap_1',
      captchaAnswer: 'ab2c',
    });
    expect(buttonByText('60秒后重发')?.className).toBe(rebindStyles.codeCooldown);
    expect(toast).toHaveBeenCalledWith('验证码已发送，5分钟内有效');
    expect(document.body.querySelector('[aria-label="安全验证"]')).toBeNull();

    const smsCode = inputByPlaceholder('请输入验证码');
    expect(smsCode).not.toBeNull();
    await act(async () => setInputValue(smsCode!, '123456'));
    expect(buttonByText('下一步')?.className).toContain(rebindStyles.submitReady);
  });
});
