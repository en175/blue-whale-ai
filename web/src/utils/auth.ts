/* ============================================
 * auth 会话门面：全局状态存储（zustand + persist）为唯一数据源
 * 登录态走 HttpOnly cookie（后端读取），本文件不再暴露任何令牌；
 * 登录是否成立只看 user 是否就位（/api/me 经 cookie 校验后回填）
 * ============================================ */
import { useAuthStore, type SessionUser } from '@/stores/auth';

export type { SessionUser };

/** 订阅登录态变化（配合 useSyncExternalStore） */
export function subscribe(fn: () => void): () => void {
  return useAuthStore.subscribe(fn);
}

/** 获取当前登录用户（未登录为 null） */
export function getCurrentUser(): SessionUser | null {
  return useAuthStore.getState().user;
}

/** 是否已登录（user 就位即认为登录，登录态由 cookie 在服务端维持） */
export function isLoggedIn(): boolean {
  return useAuthStore.getState().user !== null;
}

/** 是否为管理员 */
export function isAdmin(): boolean {
  return useAuthStore.getState().user?.isAdmin === true;
}

/** 设置会话用户（退出登录/401 失效传 null 清空） */
export function setSession(user: SessionUser | null) {
  if (user === null) {
    useAuthStore.getState().clearSession();
  } else {
    useAuthStore.getState().setSession(user);
  }
}

/** 更新本地用户信息（如修改昵称后回写） */
export function updateUser(patch: Partial<SessionUser>) {
  useAuthStore.getState().updateUser(patch);
}
