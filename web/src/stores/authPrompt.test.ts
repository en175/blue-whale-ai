import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth';
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
  useAuthStore.setState({ user: null, isNewUser: false, quota: null });
});

describe('authPrompt 会话过期门', () => {
  it('notifyExpired 只打开一次', () => {
    useAuthPromptStore.getState().notifyExpired();
    useAuthPromptStore.getState().notifyExpired();
    expect(useAuthPromptStore.getState().open).toBe(true);
  });

  it('succeed 执行续接且不清会话', () => {
    const resume = vi.fn();
    useAuthStore.setState({ user: sampleUser });
    useAuthPromptStore.getState().notifyExpired();
    useAuthPromptStore.getState().addResume(resume);
    useAuthPromptStore.getState().succeed();
    expect(resume).toHaveBeenCalledTimes(1);
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
    expect(resume).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toEqual(sampleUser);

    useAuthPromptStore.getState().notifyExpired();
    useAuthPromptStore.getState().addResume(resume);
    useAuthPromptStore.getState().abandon();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
  });
});
