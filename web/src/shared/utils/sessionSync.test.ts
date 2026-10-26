// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useAuthStore } from '@/shared/stores/auth';
import { useAuthPromptStore } from '@/shared/stores/authPrompt';
import { ACCOUNT_DISABLED_MESSAGE, SESSION_EVICTED_MESSAGE } from '@/shared/utils/sessionNotice';
import { applySessionSync, installSessionSyncListener, parseSessionSync, publishSessionSync, sessionSyncKey } from './sessionSync';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const sampleUser = {
  userId: 7,
  username: 'alice',
  email: '',
  phone: '',
  hasPassword: false,
  isAdmin: false,
};

afterEach(() => {
  localStorage.clear();
  useAuthPromptStore.getState().reset();
  useAuthStore.setState({ user: null, isNewUser: false, credits: null });
  vi.mocked(toast.error).mockClear();
});

describe('浏览器标签同步', () => {
  it('解析过期、停用、退出和登录', () => {
    expect(parseSessionSync(JSON.stringify({ kind: 'expired', errorCode: 'session_evicted' }))).toEqual({
      kind: 'expired',
      errorCode: 'session_evicted',
    });
    expect(parseSessionSync(JSON.stringify({ kind: 'disabled' }))).toEqual({ kind: 'disabled' });
    expect(parseSessionSync(JSON.stringify({ kind: 'logout' }))).toEqual({ kind: 'logout' });
    expect(parseSessionSync(JSON.stringify({ kind: 'login' }))).toEqual({ kind: 'login' });
    expect(parseSessionSync('nope')).toBeNull();
    expect(parseSessionSync(null)).toBeNull();
  });

  it('其他标签过期时打开登录门并保留当前用户', () => {
    useAuthStore.setState({ user: sampleUser });
    const stop = installSessionSyncListener();
    publishSessionSync({ kind: 'expired', errorCode: 'session_evicted' });
    window.dispatchEvent(new StorageEvent('storage', {
      key: sessionSyncKey(),
      newValue: localStorage.getItem(sessionSyncKey()),
    }));
    expect(useAuthPromptStore.getState().open).toBe(true);
    expect(useAuthPromptStore.getState().notice).toBe(SESSION_EVICTED_MESSAGE);
    expect(useAuthStore.getState().user).toEqual(sampleUser);
    stop();
  });

  it('其他标签停用时清掉登录态并提示', () => {
    useAuthStore.setState({ user: sampleUser });
    applySessionSync({ kind: 'disabled' });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthPromptStore.getState().open).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(ACCOUNT_DISABLED_MESSAGE);
  });

  it('其他标签退出时清掉登录态', () => {
    useAuthStore.setState({ user: sampleUser });
    useAuthPromptStore.getState().notifyExpired();
    applySessionSync({ kind: 'logout' });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthPromptStore.getState().open).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
