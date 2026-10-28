import { clearSessionToken, getSessionToken } from '@/shared/api/sessionToken';
import { showToast } from '@/shared/components/Toast';
import { useAuthStore, type SessionUser } from '@/shared/stores/auth';
import { useAuthPromptStore } from '@/shared/stores/authPrompt';
import { ACCOUNT_DISABLED_MESSAGE, loginPromptFor } from '@/shared/utils/sessionNotice';
import { publishSessionSync } from '@/shared/utils/sessionSync';

export type { SessionUser };

export function subscribe(fn: () => void): () => void {
  return useAuthStore.subscribe(fn);
}

export function getCurrentUser(): SessionUser | null {
  return useAuthStore.getState().user;
}

export function isLoggedIn(): boolean {
  return useAuthStore.getState().user !== null;
}

export function isAdmin(): boolean {
  return useAuthStore.getState().user?.isAdmin === true;
}

export function isSuperAdmin(): boolean {
  return useAuthStore.getState().user?.roles?.includes('super_admin') === true;
}

export function setSession(user: SessionUser | null) {
  if (user === null) {
    useAuthStore.getState().clearSession();
  } else {
    useAuthStore.getState().setSession(user);
  }
}

export function handleAccountDisabled() {
  clearSessionToken();
  useAuthPromptStore.getState().reset();
  useAuthStore.getState().clearSession();
  showToast('error', ACCOUNT_DISABLED_MESSAGE);
  publishSessionSync({ kind: 'disabled' });
}

export function handleUnauthorized(errorCode?: string, requestToken?: string | null) {
  if (errorCode === 'account_disabled') {
    handleAccountDisabled();
    return;
  }
  if (requestToken !== undefined && getSessionToken() !== requestToken) return;
  clearSessionToken();
  if (useAuthStore.getState().user) {
    useAuthPromptStore.getState().notifyExpired(loginPromptFor(errorCode));
    publishSessionSync({ kind: 'expired', errorCode });
    return;
  }
  useAuthStore.getState().clearSession();
}

export function updateUser(patch: Partial<SessionUser>) {
  useAuthStore.getState().updateUser(patch);
}
