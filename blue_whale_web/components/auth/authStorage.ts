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
    const parsed = JSON.parse(raw) as Partial<User>;
    if (parsed && typeof parsed.username === "string" && typeof parsed.phone === "string" && typeof parsed.userId === "number") {
      return { username: parsed.username, phone: parsed.phone, userId: parsed.userId };
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
