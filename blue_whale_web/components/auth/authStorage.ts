import type { User } from "./types";

const USER_KEY = "bw-user";
const ACCESS_TOKEN_KEY = "bw-access-token";
const REFRESH_TOKEN_KEY = "bw-refresh-token";

// ---- user ----

export function loadUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed.username !== "string" || typeof parsed.phone !== "string") {
      return null;
    }
    // userId 兼容 number 和 string（Fastjson2 可能将 Long 序列化为字符串）
    const uid = parsed.userId;
    const userId = typeof uid === "number" ? uid : typeof uid === "string" ? Number(uid) : null;
    if (userId == null || Number.isNaN(userId)) return null;
    return { username: parsed.username as string, phone: parsed.phone as string, userId };
  } catch {
    return null;
  }
}

export function saveUser(u: User): void {
  if (typeof window === "undefined") return;
  try {
    // 归一化 userId 为 number（Fastjson2 可能序列化 Long 为字符串）
    localStorage.setItem(USER_KEY, JSON.stringify({ ...u, userId: Number(u.userId) }));
  } catch { /* ignore */ }
}

export function clearUser(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
}

// ---- tokens ----

export function loadAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function loadRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function saveTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch { /* ignore */ }
}

export function clearTokens(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch { /* ignore */ }
}
