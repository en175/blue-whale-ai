"use client";

import {
  clearTokens,
  loadAccessToken,
  saveTokens,
} from "@/components/auth/authStorage";

export type AdminUser = { adminId: number; username: string; role: number };

export function isAdminAuthenticated(): boolean {
  return !!loadAccessToken();
}

export function getAdminUser(): AdminUser | null {
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
  saveTokens(token);
  localStorage.setItem("bw-admin-user", JSON.stringify(user));
}

export function clearAdminSession() {
  if (typeof window === "undefined") return;
  clearTokens();
  localStorage.removeItem("bw-admin-user");
}
