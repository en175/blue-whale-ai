// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/http';
import PasswordModal from './index';
import { NEW_PASSWORD_PLACEHOLDER } from './password';

const authApi = vi.hoisted(() => ({
  changePassword: vi.fn(),
}));

vi.mock('@/custom/api/auth', () => authApi);

let root: Root;
let mountNode: HTMLDivElement;

async function renderPasswordModal(props: Partial<Parameters<typeof PasswordModal>[0]> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onSuccess = props.onSuccess ?? vi.fn();
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(PasswordModal, { open: true, onClose, onSuccess, ...props }));
  });
  return { onClose, onSuccess };
}

function getSubmitButton() {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === '确认修改' || button.textContent === '修改中…',
  );
}

async function fillPasswords(oldPassword: string, newPassword: string, confirmPassword: string) {
  const inputs = [...document.body.querySelectorAll<HTMLInputElement>('input')];
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(inputs[0], oldPassword);
    inputs[0]?.dispatchEvent(new Event('input', { bubbles: true }));
    setter?.call(inputs[1], newPassword);
    inputs[1]?.dispatchEvent(new Event('input', { bubbles: true }));
    setter?.call(inputs[2], confirmPassword);
    inputs[2]?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authApi.changePassword.mockResolvedValue(null);
});

afterEach(async () => {
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('PasswordModal', () => {
  it('通过共用 Modal 以 Portal 渲染改密面板', async () => {
    await renderPasswordModal();

    expect(mountNode.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-semantic="mask"]')).not.toBeNull();
    expect(document.body.textContent).toContain('修改密码');
  });

  it('不渲染短信验证码，新密码占位为 8 位以上', async () => {
    await renderPasswordModal();

    expect(document.body.textContent).not.toContain('短信验证码');
    expect(document.body.textContent).not.toContain('获取验证码');
    expect(document.body.querySelector(`input[placeholder="${NEW_PASSWORD_PLACEHOLDER}"]`)).not.toBeNull();
    expect(document.body.textContent).not.toContain('8-128');
  });

  it('密码可见性切换文案为显示/隐藏', async () => {
    await renderPasswordModal();

    const eyes = [...document.body.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => button.textContent === '显示' || button.textContent === '隐藏',
    );
    expect(eyes).toHaveLength(3);
    expect(eyes.every((button) => button.textContent === '显示')).toBe(true);

    await act(async () => {
      eyes[0]?.click();
    });
    expect(eyes[0]?.textContent).toBe('隐藏');
  });

  it('无验证码时填完旧密码与合法新密码即可提交改密接口', async () => {
    const { onClose, onSuccess } = await renderPasswordModal();

    expect(getSubmitButton()?.disabled).toBe(true);

    await fillPasswords('old-pass', '12345678', '12345678');
    expect(getSubmitButton()?.disabled).toBe(false);

    await act(async () => {
      getSubmitButton()?.click();
      await Promise.resolve();
    });

    expect(authApi.changePassword).toHaveBeenCalledWith('old-pass', '12345678');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('接口失败时展示错误且不关闭', async () => {
    authApi.changePassword.mockRejectedValue(new ApiError(400, '原密码错误', 400));
    const { onClose } = await renderPasswordModal();

    await fillPasswords('old-pass', '12345678', '12345678');
    await act(async () => {
      getSubmitButton()?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('原密码错误');
    expect(onClose).not.toHaveBeenCalled();
  });
});
