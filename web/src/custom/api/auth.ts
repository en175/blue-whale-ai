import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/http';
import { clearSessionToken, getSessionToken, setSessionToken } from '@/shared/api/sessionToken';
import type { SessionUser } from '@/shared/utils/auth';
import type { UsageTokenData } from '@/shared/stores/auth';

export type { UsageTokenData } from '@/shared/stores/auth';

export interface LoginData {
  token: string;
  user_id: number;
  username: string;
  nickname?: string;
  email: string | null;
  phone: string;
  is_new_user: boolean;
  has_password: boolean;
}

export type SmsPurpose = 'login' | 'bind' | 'rebind_old' | 'rebind_new' | 'recovery';

export interface AuthCodeRequest {
  phone: string;
  purpose: SmsPurpose;
  captchaId: string;
  captchaAnswer: string;
}

export interface CaptchaChallenge {
  id: string;
  image: string;
  expires_in: number;
}

const AUTH_CLIENT_ID_KEY = 'bw_client_id';

export function getAuthClientId(): string {
  const saved = localStorage.getItem(AUTH_CLIENT_ID_KEY);
  if (saved && saved.length >= 8 && saved.length <= 64) return saved;
  const created =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `bw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  localStorage.setItem(AUTH_CLIENT_ID_KEY, created);
  return created;
}

export interface MeData {
  id: number;
  username: string;
  nickname?: string;
  email: string;
  phone: string;
  avatar: string | null;
  created_at: string;
  has_password?: boolean;
  is_admin?: boolean;
  roles?: string[];
}

export const toSessionUser = (m: MeData): SessionUser => ({
  userId: m.id,
  username: m.username,
  nickname: m.nickname || m.username,
  email: m.email,
  phone: m.phone,
  avatar: m.avatar ?? undefined,
  hasPassword: m.has_password ?? true,
  isAdmin: m.is_admin ?? false,
  roles: m.roles ?? [],
});

export async function loginWithPassword(username: string, password: string) {
  const data = await apiRequest<LoginData>('/api/auth/login', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({ username, password }),
  });
  setSessionToken(data.token);
  return data;
}

export function sendCode(phone: string): Promise<null>;
export function sendCode(request: AuthCodeRequest): Promise<null>;
export function sendCode(phoneOrRequest: string | AuthCodeRequest) {
  const body =
    typeof phoneOrRequest === 'string'
      ? { phone: phoneOrRequest }
      : {
          phone: phoneOrRequest.phone,
          purpose: phoneOrRequest.purpose,
          captcha_id: phoneOrRequest.captchaId,
          captcha_answer: phoneOrRequest.captchaAnswer,
        };
  return apiRequest<null>('/api/auth/send-code', {
    method: 'POST',
    silent: true,
    body: JSON.stringify(body),
  });
}

export function fetchCaptcha(phone: string, purpose: SmsPurpose) {
  const query = new URLSearchParams({ phone, purpose });
  return apiRequest<CaptchaChallenge>(`/api/auth/captcha?${query.toString()}`, { silent: true });
}

export async function loginWithCode(phone: string, code: string, agreedTerms = true) {
  const data = await apiRequest<LoginData>('/api/auth/login-by-code', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({
      phone,
      code,
      agreed_terms: agreedTerms,
      client_id: getAuthClientId(),
    }),
  });
  setSessionToken(data.token);
  return data;
}

export function verifyMigrationPassword(username: string, password: string) {
  return apiRequest<{ migration_token: string; expires_in: number }>(
    '/api/auth/migration/verify-password',
    {
      method: 'POST',
      silent: true,
      body: JSON.stringify({ username, password }),
    },
  );
}

export async function bindMigrationPhone(input: {
  migrationToken: string;
  phone: string;
  code: string;
  agreedTerms: boolean;
}) {
  const data = await apiRequest<LoginData>('/api/auth/migration/bind-phone', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({
      migration_token: input.migrationToken,
      phone: input.phone,
      code: input.code,
      agreed_terms: input.agreedTerms,
      client_id: getAuthClientId(),
    }),
  });
  setSessionToken(data.token);
  return data;
}

export function bindPhone(phone: string, code: string) {
  return apiRequest<null>('/api/me/phone', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({ phone, code }),
  });
}

export async function registerWithPassword(username: string, password: string, email?: string) {
  const body: Record<string, string> = { username, password };
  if (email) body.email = email;
  const data = await apiRequest<LoginData>('/api/auth/register', {
    method: 'POST',
    silent: true,
    body: JSON.stringify(body),
  });
  setSessionToken(data.token);
  return data;
}

export function fetchMe() {
  return apiRequest<MeData>('/api/me', { silent: true });
}

export const accountProfileKeys = {
  all: ['account-profile'] as const,
  detail: (userId: number) => [...accountProfileKeys.all, 'detail', userId] as const,
};

export function accountProfileOptions(userId: number) {
  return queryOptions({
    queryKey: accountProfileKeys.detail(userId),
    queryFn: () => fetchMe(),
  });
}

export function fetchCredits(options?: { fresh?: boolean }) {
  const path = options?.fresh ? `/api/usage/token?_=${Date.now()}` : '/api/usage/token';
  return apiRequest<UsageTokenData>(path);
}

export async function logout() {
  const token = getSessionToken();
  clearSessionToken();
  return apiRequest<null>('/api/auth/logout', {
    method: 'POST',
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
}

export function changePassword(originalPassword: string | null, newPassword: string) {
  const body: Record<string, string> = { password: newPassword };
  if (originalPassword !== null) body.original_password = originalPassword;
  return apiRequest<null>('/api/me/password', {
    method: 'PUT',
    silent: true,
    body: JSON.stringify(body),
  });
}

export function updateUsername(username: string) {
  return apiRequest<unknown>('/api/user/username', {
    method: 'PUT',
    body: JSON.stringify({ username }),
  });
}

export function updateNickname(nickname: string) {
  return apiRequest<{ nickname: string; changed: boolean }>('/api/me/nickname', {
    method: 'PATCH',
    silent: true,
    body: JSON.stringify({ nickname }),
  });
}

export function verifyCurrentPhoneForRebind(code: string) {
  return apiRequest<{ rebind_token: string; expires_in: number }>(
    '/api/me/phone/rebind/verify-current',
    {
      method: 'POST',
      silent: true,
      body: JSON.stringify({ code }),
    },
  );
}

export function submitPhoneRebind(input: { rebindToken: string; phone: string; code: string }) {
  return apiRequest<{ phone: string; revoked_sessions: number; relogin_required: boolean }>(
    '/api/me/phone/rebind',
    {
      method: 'POST',
      silent: true,
      body: JSON.stringify({
        rebind_token: input.rebindToken,
        phone: input.phone,
        code: input.code,
      }),
    },
  );
}
