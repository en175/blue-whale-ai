/* ============================================
 * auth 会话门面：全局状态存储（zustand + persist）为唯一数据源
 * 本文件向 http/guards/布局/组件提供函数式 API，保持调用方零改动
 * ============================================ */
import { useAuthStore, type SessionUser } from '@/stores/auth';

export type { SessionUser };

/** 订阅登录态变化（配合 useSyncExternalStore） */
export function subscribe(fn: () => void): () => void {
  return useAuthStore.subscribe(fn);
}

/** 获取访问令牌（http 层附加 Authorization 用） */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

/** 获取当前登录用户（未登录为 null） */
export function getCurrentUser(): SessionUser | null {
  return useAuthStore.getState().user;
}

/** 是否已登录 */
export function isLoggedIn(): boolean {
  const s = useAuthStore.getState();
  return s.accessToken !== null && s.user !== null;
}

/** 是否为管理员 */
export function isAdmin(): boolean {
  return useAuthStore.getState().user?.isAdmin === true;
}

/** 设置会话（退出登录/401 失效传 null 清空） */
export function setSession(token: string | null, user: SessionUser | null) {
  if (token === null || user === null) {
    useAuthStore.getState().clearSession();
  } else {
    useAuthStore.getState().setSession(token, user);
  }
}

/** 更新本地用户信息（如修改昵称后回写） */
export function updateUser(patch: Partial<SessionUser>) {
  useAuthStore.getState().updateUser(patch);
}
