import { showToast } from '@/shared/components/Toast';
import { useAuthPromptStore } from '@/shared/stores/authPrompt';
import { useAuthStore } from '@/shared/stores/auth';
import { ACCOUNT_DISABLED_MESSAGE, loginPromptFor } from '@/shared/utils/sessionNotice';

const SESSION_EVENT_KEY = 'bw-session-event';

export type SessionSyncEvent =
  | { kind: 'expired'; errorCode?: string }
  | { kind: 'disabled' }
  | { kind: 'logout' }
  | { kind: 'login' };

export function sessionSyncKey(): string {
  return SESSION_EVENT_KEY;
}

export function publishSessionSync(event: SessionSyncEvent): void {
  try {
    localStorage.setItem(SESSION_EVENT_KEY, JSON.stringify({ ...event, at: Date.now() }));
  } catch {
    return;
  }
}

export function parseSessionSync(raw: string | null): SessionSyncEvent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { kind?: unknown; errorCode?: unknown };
    if (value.kind === 'expired') {
      return {
        kind: 'expired',
        errorCode: typeof value.errorCode === 'string' ? value.errorCode : undefined,
      };
    }
    if (value.kind === 'disabled' || value.kind === 'logout' || value.kind === 'login') {
      return { kind: value.kind };
    }
    return null;
  } catch {
    return null;
  }
}

export function applySessionSync(event: SessionSyncEvent): void {
  if (event.kind === 'expired') {
    if (useAuthStore.getState().user) {
      useAuthPromptStore.getState().notifyExpired(loginPromptFor(event.errorCode));
    }
    return;
  }
  if (event.kind === 'disabled') {
    useAuthPromptStore.getState().reset();
    useAuthStore.getState().clearSession();
    showToast('error', ACCOUNT_DISABLED_MESSAGE);
    return;
  }
  if (event.kind === 'logout') {
    useAuthPromptStore.getState().reset();
    useAuthStore.getState().clearSession();
    return;
  }
  void Promise.resolve(useAuthStore.persist.rehydrate()).then(() => {
    useAuthPromptStore.getState().reset();
  });
}

export function installSessionSyncListener(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_EVENT_KEY) return;
    const parsed = parseSessionSync(event.newValue);
    if (parsed) applySessionSync(parsed);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
