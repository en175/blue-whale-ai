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

/**
 * GET /api/usage/token 返回。
 *
 * ⚠️ 路径里的 `token` 是 new-api 时期的命名，**值已经换成 billing 账本里的整数积分**。
 * 看到 `quota` 这个词时一律按「可用余额」理解，不要再按 new-api 的 quota 单位去除以 50,000。
 */
export interface UsageTokenData {
  /** 可用余额，**整数积分** —— billing 账本里那个数，与后端记的完全一致 */
  credits: number;
  /**
   * 同一笔余额**按来源拆开**的分量（充值 / 充值赠送 / 每日赠送…）。
   *
   * <p>`source` 用的是**批次**的取名（`purchased` / `bonus` / `daily`…），
   * 与流水的类型（`recharge` / `bonus`…）不是同一组字面量。
   *
   * <p>⚠️ 它不是第二个金额：**Σ by_source 逐字等于 `credits`**（服务端同一条 SQL 的
   * 两种投影）。界面上的总积分按它相加得到，与 `credits` 对不上就是 bug。
   * 老服务端没有这个字段时是 `undefined`，此时按 `credits` 显示。
   */
  by_source?: { source: string; credits: number }[];
}

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
    silent: true,
    body: JSON.stringify({ username, password }),
  });
}

/** 账号密码注册 */
export function registerWithPassword(username: string, password: string, email?: string) {
  const body: Record<string, string> = { username, password };
  if (email) body.email = email;
  return apiRequest<LoginData>('/api/auth/register', {
    method: 'POST',
    silent: true,
    body: JSON.stringify(body),
  });
}

/** 获取当前登录用户信息 */
export function fetchMe() {
  return apiRequest<MeData>('/api/me', { silent: true });
}

/** 获取可用余额。fresh 时带时间戳，避免与在途 GET 去重/缓存命中支付前的 0。 */
export function fetchCredits(options?: { fresh?: boolean }) {
  const path = options?.fresh ? `/api/usage/token?_=${Date.now()}` : '/api/usage/token';
  return apiRequest<UsageTokenData>(path);
}

/** 退出登录 */
export function logout() {
  return apiRequest<null>('/api/auth/logout', { method: 'POST' });
}

/** 修改密码（IKBRCK：PUT /api/me/password） */
export function changePassword(originalPassword: string, newPassword: string) {
  return apiRequest<null>('/api/me/password', {
    method: 'PUT',
    silent: true,
    body: JSON.stringify({
      original_password: originalPassword,
      password: newPassword,
    }),
  });
}

/** 修改用户名（后端暂未实现，保留接口定义供未来对接） */
export function updateUsername(username: string) {
  return apiRequest<unknown>('/api/user/username', {
    method: 'PUT',
    body: JSON.stringify({ username }),
  });
}
