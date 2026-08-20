/* ============================================
 * auth 全局状态存储：登录会话信息 + localStorage 持久化（zustand persist）
 * 登录接口返回的 token/refresh/expires/用户信息统一存于此处，刷新不失效
 * ============================================ */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 会话用户（对应 GET /api/me 返回结构） */
export interface SessionUser {
  userId: number;
  username: string;
  email: string;
  phone: string;
  /** 头像 URL，无头像为 undefined */
  avatar?: string;
  hasPassword: boolean;
  isAdmin: boolean;
}

/** POST /api/auth/login 响应 payload（结构类型） */
export interface LoginPayload {
  /** 访问令牌，sk- 开头，后续 Authorization 头携带 */
  access_token: string;
  /** 刷新令牌，当前未启用，空字符串 */
  refresh_token?: string;
  /** 过期秒数，当前未启用，0 */
  expires_in?: number;
  user_id: number;
  username: string;
  email: string;
  phone: string;
  /** 是否新注册用户 */
  is_new_user?: boolean;
  has_password: boolean;
}

interface AuthState {
  /** 访问令牌（未登录为 null） */
  accessToken: string | null;
  /** 刷新令牌（当前未启用） */
  refreshToken: string;
  /** 过期秒数（当前未启用） */
  expiresIn: number;
  /** 是否新注册用户 */
  isNewUser: boolean;
  /** 当前登录用户（未登录为 null） */
  user: SessionUser | null;
  /** 用户剩余配额（new-api 原生单位，展示积分 = quota / 50000；未拉取为 null） */
  quota: number | null;
  /** 登录成功后写入接口返回的完整信息 + 用户信息 */
  applyLogin: (login: LoginPayload, user: SessionUser) => void;
  /** 直接设置会话（http 层/兜底场景） */
  setSession: (token: string, user: SessionUser) => void;
  /** 清空会话（退出登录/401 失效） */
  clearSession: () => void;
  /** 写入 /api/usage/token 配额 */
  setQuota: (quota: number | null) => void;
  /** 局部更新用户信息（如修改昵称后回写） */
  updateUser: (patch: Partial<SessionUser>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: '',
      expiresIn: 0,
      isNewUser: false,
      user: null,
      quota: null,

      applyLogin: (login, user) =>
        set({
          accessToken: login.access_token,
          refreshToken: login.refresh_token ?? '',
          expiresIn: login.expires_in ?? 0,
          isNewUser: login.is_new_user ?? false,
          user,
        }),

      setSession: (token, user) => set({ accessToken: token, user }),

      clearSession: () =>
        set({ accessToken: null, refreshToken: '', expiresIn: 0, isNewUser: false, user: null, quota: null }),

      setQuota: (quota) => set({ quota }),

      updateUser: (patch) =>
        set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
    }),
    // 持久化到 localStorage，刷新/重开页面登录态不失效（quota 不持久化，每次挂载重新拉取）
    {
      name: 'bw-auth',
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        expiresIn: s.expiresIn,
        isNewUser: s.isNewUser,
        user: s.user,
      }),
    }
  )
);
