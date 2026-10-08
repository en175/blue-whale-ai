import { apiRequest } from './http';
import { clearSessionToken, getSessionToken, setSessionToken } from './sessionToken';
import type { SessionUser } from '@/utils/auth';

export interface LoginData {
  token: string;
  user_id: number;
  username: string;
  email: string;
  phone: string;
  is_new_user: boolean;
  has_password: boolean;
}

export interface MeData {
  id: number;
  username: string;
  email: string;
  phone: string;
  avatar: string | null;
  created_at: string;
  has_password?: boolean;
  is_admin?: boolean;
}

export interface UsageTokenData {
  credits: number;
  by_source?: { source: string; credits: number }[];
}

export const toSessionUser = (m: MeData): SessionUser => ({
  userId: m.id,
  username: m.username,
  email: m.email,
  phone: m.phone,
  avatar: m.avatar ?? undefined,
  hasPassword: m.has_password ?? true,
  isAdmin: m.is_admin ?? false,
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

export function sendCode(phone: string) {
  return apiRequest<null>('/api/auth/send-code', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({ phone }),
  });
}

export async function loginWithCode(phone: string, code: string) {
  const data = await apiRequest<LoginData>('/api/auth/login-by-code', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({ phone, code }),
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
