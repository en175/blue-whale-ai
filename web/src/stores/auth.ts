/* ============================================
 * auth 全局状态存储：登录用户信息 + localStorage 持久化（zustand persist）
 * 登录态走 HttpOnly 会话 cookie（后端读取），JS 不存任何令牌；
 * 这里只存展示用用户信息，刷新后由 /api/me 恢复
 * ============================================ */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
// ⚠️ 只导入**类型**：`api/auth` → `api/http` → `utils/auth` 会绕回来引用本模块，
//    值导入会构成运行时循环。类型导入在编译期被抹掉，环就断了。
import type { UsageTokenData } from '@/api/auth';

/**
 * 界面要显示的总积分 = **各类型相加**。
 *
 * <p>`by_source` 缺失或为空（老服务端）时退回服务端的 `credits`——没有分项可加，
 * 只能信它给的那个数。
 *
 * <p>⚠️ **服务端保证 `Σ by_source === credits`**（同一条 SQL 的两种投影，Java 侧有
 * 不变量测试钉住）。两条路只在「这个保证被破坏」时才分叉，而那时必须**说出来**：
 * 静默地照常返回，界面看起来一切正常，服务端两处谓词分叉这件事就永远没人发现
 * ——那正是这个功能最该防的失败模式。分叉时显示**账本那个数**（它才是权威）。
 *
 * <p>放在 store 而不是 API 层：它是**展示口径**，而且三个渲染点读的是同一个 store 字段，
 * 相加逻辑只此一处（将来做明细 UI 也不会冒出第二个算法）。
 */
export function totalCreditsOf(data: UsageTokenData): number {
  const items = data.by_source;
  if (!items || items.length === 0) return data.credits;

  const summed = items.reduce((sum, item) => sum + item.credits, 0);
  if (summed !== data.credits) {
    console.warn(
      `[credits] by_source 之和（${summed}）与账本总额（${data.credits}）不一致，以账本为准`,
    );
    return data.credits;
  }
  return summed;
}

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
  /**
   * 写入 /api/usage/token 的余额结果；传 null = 没拉到（清空）。
   *
   * <p>显示用的总数在这里按「各类型相加」算出来（`totalCreditsOf`），
   * 与后端账本那个数不一致时以账本为准 —— 三个渲染点读的是同一个字段，
   * 相加逻辑只此一处。
   */
  setUsage: (data: UsageTokenData | null) => void;
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

      setUsage: (data) =>
        set({ credits: data ? totalCreditsOf(data) : null }),

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
