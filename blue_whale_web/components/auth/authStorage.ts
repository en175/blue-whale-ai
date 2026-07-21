import type { User } from "./types";

const USER_KEY = "bw-user";
const ACCESS_TOKEN_KEY = "bw-access-token";
const REFRESH_TOKEN_KEY = "bw-refresh-token";

/**
 * 本地开发开关：仅当 .env.local 里 NEXT_PUBLIC_SKIP_AUTH=1 时为 true。
 * 用于跳过前端登录门槛（画布守卫 + requireAuth）。默认关闭，不影响线上。
 * 注意：只跳过前端；打到后端的接口仍会被网关 JWT 校验。
 */
export const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "1";

/** SKIP_AUTH 模式下注入的占位用户，让 UI 呈现已登录态。 */
export const MOCK_USER: User = {
  userId: 1,
  username: "本地测试用户",
  phone: "13800000000",
  hasPassword: false,
};

// ---- user ----

export function loadUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !parsed ||
      typeof parsed.username !== "string" ||
      typeof parsed.phone !== "string"
    ) {
      return null;
    }
    // userId 兼容 number 和 string（Fastjson2 可能将 Long 序列化为字符串）
    const uid = parsed.userId;
    const userId =
      typeof uid === "number"
        ? uid
        : typeof uid === "string"
          ? Number(uid)
          : null;
    if (userId == null || Number.isNaN(userId)) return null;
    return {
      username: parsed.username as string,
      phone: parsed.phone as string,
      userId,
      hasPassword:
        typeof parsed.hasPassword === "boolean"
          ? parsed.hasPassword
          : undefined,
    };
  } catch {
    return null;
  }
}

export function saveUser(u: User): void {
  if (typeof window === "undefined") return;
  try {
    // 归一化 userId 为 number（Fastjson2 可能序列化 Long 为字符串）
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({ ...u, userId: Number(u.userId) }),
    );
  } catch {
    /* ignore */
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
  } catch {
    /* ignore */
  }
}

export function clearTokens(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
