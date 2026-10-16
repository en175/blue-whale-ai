import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UsageTokenLot {
  credits: number;
  expires_at: string;
  source: string;
}

export interface UsageTokenData {
  credits: number;
  by_source?: { source: string; credits: number }[];
  expiring?: UsageTokenLot[];
}

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

export interface SessionUser {
  userId: number;
  username: string;
  email: string;
  phone: string;
  avatar?: string;
  hasPassword: boolean;
  isAdmin: boolean;
  roles?: string[];
}

export interface LoginPayload {
  user_id: number;
  username: string;
  email: string;
  phone: string;
  is_new_user?: boolean;
  has_password: boolean;
}

interface AuthState {
  isNewUser: boolean;
  user: SessionUser | null;
  credits: number | null;
  applyLogin: (login: LoginPayload, user: SessionUser) => void;
  setSession: (user: SessionUser | null) => void;
  clearSession: () => void;
  setUsage: (data: UsageTokenData | null) => void;
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
    {
      name: 'bw-auth',
      partialize: (s) => ({
        isNewUser: s.isNewUser,
        user: s.user,
      }),
    }
  )
);
