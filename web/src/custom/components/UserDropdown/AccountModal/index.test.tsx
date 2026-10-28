// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCaptcha, fetchMe, sendCode, updateNickname } from '@/custom/api/auth';
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
  const fetchMe = vi.fn(async (): Promise<typeof profile> => profile);
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

async function renderAccountModal(onClose = vi.fn(), onRequireLogin = vi.fn(), phone = '') {
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
          phone,
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

async function renderAccountModalWhileProfileFails() {
  vi.mocked(fetchMe).mockRejectedValueOnce(new Error('network down'));
  await renderAccountModal(vi.fn(), vi.fn(), '13900000009');
  await act(async () => {
    await vi.waitFor(() => {
      if (!document.body.textContent?.includes('加载失败，请重试')) throw new Error('失败态尚未渲染');
    });
  });
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

function saveButton() {
  return buttonByText('保存');
}

function nicknameMetaText() {
  return document.body.querySelector<HTMLSpanElement>('[role="alert"]') ?? null;
}

function countText() {
  return [...document.body.querySelectorAll<HTMLSpanElement>('span')].find(
    (span) => /^\d+\/20$/.test(span.textContent ?? ''),
  );
}

async function enterNicknameEdit() {
  await waitForProfile();
  await act(async () => buttonByText('修改')?.click());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchCaptcha).mockClear();
  vi.mocked(sendCode).mockClear();
  vi.mocked(updateNickname).mockClear();
  vi.mocked(updateNickname).mockImplementation(async (nickname: string) => ({ nickname, changed: true }));
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
      expect(saveButton()?.disabled).toBe(true);
      await act(async () => saveButton()?.click());
      expect(updateNickname).not.toHaveBeenCalled();
      expect(nicknameInput()?.getAttribute('aria-invalid')).toBe('true');
      expect(document.body.textContent).toContain(
        '2—20个字符，仅支持中文、英文大小写字母、数字、下划线（_）和短横线（-）。',
      );
      await act(async () => buttonByText('取消')?.click());
    }
  });

  it('未修改昵称时保存不可用，改回原值后再次不可用', async () => {
    await renderAccountModal();
    await enterNicknameEdit();
    expect(saveButton()?.disabled).toBe(true);

    await act(async () => setInputValue(nicknameInput()!, '蓝鲸用户_NACRQY'));
    expect(saveButton()?.disabled).toBe(false);

    await act(async () => setInputValue(nicknameInput()!, '蓝鲸用户_NACRQX'));
    expect(saveButton()?.disabled).toBe(true);
    await act(async () => saveButton()?.click());
    expect(updateNickname).not.toHaveBeenCalled();
  });

  it('非法昵称禁用保存且不提交', async () => {
    await renderAccountModal();
    await enterNicknameEdit();

    await act(async () => setInputValue(nicknameInput()!, '含 空格'));
    expect(saveButton()?.disabled).toBe(true);
    expect(nicknameInput()?.getAttribute('aria-invalid')).toBe('true');
    expect(nicknameMetaText()).not.toBeNull();
    await act(async () => saveButton()?.click());
    expect(updateNickname).not.toHaveBeenCalled();

    await act(async () => setInputValue(nicknameInput()!, '新昵称'));
    expect(saveButton()?.disabled).toBe(false);
    expect(nicknameInput()?.hasAttribute('aria-invalid')).toBe(false);
    expect(nicknameMetaText()).toBeNull();
  });

  it('输入法组词中禁用保存，选词完成后可保存', async () => {
    await renderAccountModal();
    await enterNicknameEdit();
    const input = nicknameInput()!;

    await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await act(async () => setInputValue(input, 'nihao'));
    expect(saveButton()?.disabled).toBe(true);
    await act(async () => saveButton()?.click());
    expect(updateNickname).not.toHaveBeenCalled();

    await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await act(async () => setInputValue(input, '你好'));
    expect(saveButton()?.disabled).toBe(false);
  });

  it('超长输入计数标红并禁用保存', async () => {
    await renderAccountModal();
    await enterNicknameEdit();
    await act(async () => setInputValue(nicknameInput()!, 'a'.repeat(21)));

    expect(countText()?.textContent).toBe('21/20');
    expect(nicknameInput()?.getAttribute('aria-invalid')).toBe('true');
    expect(nicknameMetaText()).not.toBeNull();
    expect(saveButton()?.disabled).toBe(true);
    await act(async () => saveButton()?.click());
    expect(updateNickname).not.toHaveBeenCalled();
  });

  it('保存中锁住输入、取消和关闭，成功后才退出编辑', async () => {
    let finish: (value: { nickname: string; changed: boolean }) => void = () => undefined;
    vi.mocked(updateNickname).mockImplementation(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { onClose } = await renderAccountModal();
    await enterNicknameEdit();
    await act(async () => setInputValue(nicknameInput()!, '新昵称'));
    await act(async () => saveButton()?.click());

    expect(nicknameInput()?.disabled).toBe(true);
    expect(buttonByText('保存中…')?.disabled).toBe(true);
    expect(buttonByText('取消')?.disabled).toBe(true);

    await act(async () => buttonByText('取消')?.click());
    await act(async () => document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(nicknameInput()).not.toBeNull();
    expect(nicknameInput()?.value).toBe('新昵称');
    expect(buttonByText('保存中…')).toBeTruthy();

    await act(async () => {
      finish({ nickname: '新昵称', changed: true });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.waitFor(() => expect(nicknameInput()).toBeNull());
    });
    expect(document.body.textContent).toContain('新昵称');
  });

  it('更换手机号先做图形验证，通过后按原号用途发短信', async () => {    await renderAccountModal();
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

  it('资料加载失败时只展示重试，不提供修改和更换', async () => {
    await renderAccountModalWhileProfileFails();

    const retry = buttonByText('重试');
    expect(retry).toBeTruthy();
    expect(document.body.textContent).toContain('加载失败，请重试');
    expect(buttonByText('修改')).toBeUndefined();
    expect(buttonByText('更换')).toBeUndefined();

    await act(async () => retry?.click());
    await act(async () => {
      await vi.waitFor(() => expect(document.body.textContent).toContain('蓝鲸用户_NACRQX'));
    });
    expect(document.body.textContent).not.toContain('加载失败，请重试');
    expect(buttonByText('修改')?.disabled).toBe(false);
    expect(buttonByText('更换')?.disabled).toBe(false);
  });

  it('换绑改号后清空发给旧号的验证码和倒计时', async () => {
    await renderAccountModal();
    await waitForProfile();
    await act(async () => buttonByText('更换')?.click());
    await act(async () => buttonByText('获取验证码')?.click());
    await act(async () => setInputValue(inputByPlaceholder('请输入图中字符')!, 'ab2c'));
    await act(async () => setInputValue(inputByPlaceholder('请输入验证码')!, '123456'));
    await act(async () => buttonByText('下一步')?.click());
    await act(async () => {
      await vi.waitFor(() => expect(inputByPlaceholder('请输入新手机号')).not.toBeNull());
    });

    await act(async () => setInputValue(inputByPlaceholder('请输入新手机号')!, '13900000010'));
    await act(async () => buttonByText('获取验证码')?.click());
    await act(async () => setInputValue(inputByPlaceholder('请输入图中字符')!, 'ab2c'));
    expect(sendCode).toHaveBeenLastCalledWith(expect.objectContaining({ phone: '13900000010', purpose: 'rebind_new' }));
    await act(async () => setInputValue(inputByPlaceholder('请输入验证码')!, '654321'));
    expect(buttonByText('60秒后重发')).toBeTruthy();

    await act(async () => setInputValue(inputByPlaceholder('请输入新手机号')!, '13900000011'));
    expect(inputByPlaceholder('请输入验证码')?.value).toBe('');
    expect(buttonByText('获取验证码')).toBeTruthy();
  });
});
