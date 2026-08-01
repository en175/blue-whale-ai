"use client";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "1";

export type AdminUser = { adminId: number; username: string; role: number };

const MOCK_ADMIN: AdminUser = { adminId: 1, username: "admin", role: 100 };

export function isAdminAuthenticated(): boolean {
  if (SKIP_AUTH) return true;
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("bw-admin-token");
}

export function getAdminUser(): AdminUser | null {
  if (SKIP_AUTH) return MOCK_ADMIN;
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("bw-admin-user");
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    return null;
  }
}

export function saveAdminSession(token: string, user: AdminUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem("bw-admin-token", token);
  localStorage.setItem("bw-admin-user", JSON.stringify(user));
}

export function clearAdminSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("bw-admin-token");
  localStorage.removeItem("bw-admin-user");
}
