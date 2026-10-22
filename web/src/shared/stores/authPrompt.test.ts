import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/shared/stores/auth';
import { useAuthPromptStore } from './authPrompt';

const sampleUser = {
  userId: 1,
  username: 'alice',
  email: '',
  phone: '',
  hasPassword: true,
  isAdmin: false,
};

afterEach(() => {
  useAuthPromptStore.getState().reset();
  useAuthStore.setState({ user: null, isNewUser: false, credits: null });
});

describe('authPrompt 会话过期门', () => {
  it('notifyExpired 只打开一次', () => {
    useAuthPromptStore.getState().notifyExpired();
    useAuthPromptStore.getState().notifyExpired();
    expect(useAuthPromptStore.getState().open).toBe(true);
  });

  it('succeed 关掉登录门并丢掉续接，不重发', () => {
    const resume = vi.fn();
    useAuthStore.setState({ user: sampleUser });
    useAuthPromptStore.getState().notifyExpired('登录已过期，请重新验证');
    useAuthPromptStore.getState().addResume(resume);
    useAuthPromptStore.getState().succeed();
    expect(resume).not.toHaveBeenCalled();
    expect(useAuthPromptStore.getState().open).toBe(false);
    expect(useAuthPromptStore.getState().notice).toBeNull();
    expect(useAuthStore.getState().user).toEqual(sampleUser);
  });

  it('dismiss 只关掉登录门，保留原身份和页面', () => {
    const resume = vi.fn();
    useAuthStore.setState({ user: sampleUser });
    useAuthPromptStore.getState().notifyExpired('登录已失效，账号已在其他浏览器登录，请重新验证');
    useAuthPromptStore.getState().addResume(resume);
    useAuthPromptStore.getState().dismiss();
    expect(resume).not.toHaveBeenCalled();
    expect(useAuthPromptStore.getState().open).toBe(false);
    expect(useAuthStore.getState().user).toEqual(sampleUser);
  });

  it('abandon 丢掉续接并清会话；成功后的 onClose 不再清会话', () => {
    const resume = vi.fn();
    useAuthStore.setState({ user: sampleUser });
    useAuthPromptStore.getState().notifyExpired();
    useAuthPromptStore.getState().addResume(resume);
    useAuthPromptStore.getState().succeed();
    useAuthPromptStore.getState().abandon();
    expect(resume).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toEqual(sampleUser);

    useAuthPromptStore.getState().notifyExpired();
    useAuthPromptStore.getState().addResume(resume);
    useAuthPromptStore.getState().abandon();
    expect(resume).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
