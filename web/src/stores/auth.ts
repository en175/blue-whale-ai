/* ============================================
 * auth 全局状态存储：登录用户信息 + localStorage 持久化（zustand persist）
 * 登录态走 HttpOnly 会话 cookie（后端读取），JS 不存任何令牌；
 * 这里只存展示用用户信息，刷新后由 /api/me 恢复
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

/** POST /api/auth/login 响应 payload（结构类型，不含令牌） */
export interface LoginPayload {
  user_id: number;
  username: string;
  email: string;
  phone: string;
  /** 是否新注册用户 */
  is_new_user?: boolean;
  has_password: boolean;
}

interface AuthState {
  /** 是否新注册用户 */
  isNewUser: boolean;
  /** 当前登录用户（未登录为 null） */
  user: SessionUser | null;
  /** 用户可用余额（**整数积分**，来自 billing 账本；未拉取为 null） */
  credits: number | null;
  /** 登录成功后写入用户信息 */
  applyLogin: (login: LoginPayload, user: SessionUser) => void;
  /** 直接设置用户（http 层/兜底场景） */
  setSession: (user: SessionUser | null) => void;
  /** 清空会话（退出登录/401 失效） */
  clearSession: () => void;
  /** 写入 /api/usage/token 的余额 */
  setCredits: (credits: number | null) => void;
  /** 局部更新用户信息（如修改昵称后回写） */
  updateUser: (patch: Partial<SessionUser>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isNewUser: false,
      user: null,
      credits: null,

      applyLogin: (login, user) =>
        set({
          isNewUser: login.is_new_user ?? false,
          user,
        }),

      setSession: (user) => set({ user }),

      clearSession: () =>
        set({ isNewUser: false, user: null, credits: null }),

      setCredits: (credits) => set({ credits }),

      updateUser: (patch) =>
        set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
    }),
    // 持久化 user 信息到 localStorage（不含任何令牌；刷新后由 /api/me 校验 cookie 恢复）
    {
      name: 'bw-auth',
      partialize: (s) => ({
        isNewUser: s.isNewUser,
        user: s.user,
      }),
    }
  )
);
