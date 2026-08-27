/* ============================================
 * auth 接口：登录/退出/当前用户/积分配额，对接真实后端
 * ============================================ */
import { apiRequest } from './http';
import type { SessionUser } from '@/utils/auth';

/** POST /api/auth/login 返回（登录态走 HttpOnly 会话 cookie，响应不含任何令牌） */
export interface LoginData {
  user_id: number;
  username: string;
  email: string;
  phone: string;
  is_new_user: boolean;
  has_password: boolean;
}

/** GET /api/me 返回 */
export interface MeData {
  /** 用户ID */
  id: number;
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email: string;
  /** 手机号（可为空串） */
  phone: string;
  /** 头像 URL，无头像为 null */
  avatar: string | null;
  /** 注册时间（ISO 字符串） */
  created_at: string;
  /** 兼容旧字段：是否设置过密码（新接口不再返回） */
  has_password?: boolean;
  /** 兼容旧字段：是否管理员（新接口不再返回） */
  is_admin?: boolean;
}

/** GET /api/usage/token 返回 */
export interface UsageTokenData {
  quota: number;
}

/** 配额 → 展示积分（产品口径：1 元 = 10 积分 = 1 美元 = 500,000 quota → quota / 50000，千分位格式化） */
export const quotaToPoints = (quota: number) => (quota / 50000).toLocaleString();

/** /api/me 结构转本地会话用户 */
export const toSessionUser = (m: MeData): SessionUser => ({
  userId: m.id,
  username: m.username,
  email: m.email,
  phone: m.phone,
  avatar: m.avatar ?? undefined,
  hasPassword: m.has_password ?? true,
  isAdmin: m.is_admin ?? false,
});

/** 账号密码登录 */
export function loginWithPassword(username: string, password: string) {
  return apiRequest<LoginData>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

/** 账号密码注册 */
export function registerWithPassword(username: string, password: string, email?: string) {
  const body: Record<string, string> = { username, password };
  if (email) body.email = email;
  return apiRequest<LoginData>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** 获取当前登录用户信息 */
export function fetchMe() {
  return apiRequest<MeData>('/api/me');
}

/** 获取积分配额 */
export function fetchQuota() {
  return apiRequest<UsageTokenData>('/api/usage/token');
}

/** 退出登录 */
export function logout() {
  return apiRequest<null>('/api/auth/logout', { method: 'POST' });
}

/** 修改用户名（后端暂未实现，保留接口定义供未来对接） */
export function updateUsername(username: string) {
  return apiRequest<unknown>('/api/user/username', {
    method: 'PUT',
    body: JSON.stringify({ username }),
  });
}
