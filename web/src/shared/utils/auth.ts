import { clearSessionToken } from '@/shared/api/sessionToken';
import { useAuthStore, type SessionUser } from '@/shared/stores/auth';
import { useAuthPromptStore } from '@/shared/stores/authPrompt';

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

export function setSession(user: SessionUser | null) {
  if (user === null) {
    useAuthStore.getState().clearSession();
  } else {
    useAuthStore.getState().setSession(user);
  }
}

export function handleUnauthorized() {
  clearSessionToken();
  if (useAuthStore.getState().user) {
    useAuthPromptStore.getState().notifyExpired();
    return;
  }
  useAuthStore.getState().clearSession();
}

export function updateUser(patch: Partial<SessionUser>) {
  useAuthStore.getState().updateUser(patch);
}
