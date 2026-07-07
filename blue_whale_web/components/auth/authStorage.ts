/**
 * authStorage —— 登录态 localStorage 数据层（纯函数，抄 projectStore.ts 的 SSR 安全范式）
 *
 * 键 `bw-user` 存 { username, phone }。避开画布的 `bw-canvas-*` 前缀，零冲突。
 * SSR 安全：typeof window 守卫 + try/catch 静默丢弃。
 */
import type { User } from "./types";

const USER_KEY = "bw-user";

export function loadUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User>;
    if (
      parsed &&
      typeof parsed.username === "string" &&
      typeof parsed.phone === "string"
    ) {
      return { username: parsed.username, phone: parsed.phone };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveUser(u: User): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  } catch {
    /* 配额溢出等异常，静默丢弃 */
  }
}

export function clearUser(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}
