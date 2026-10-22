import { create } from 'zustand';
import { useAuthStore } from '@/shared/stores/auth';
import { SESSION_EXPIRED_MESSAGE } from '@/shared/utils/sessionNotice';

interface AuthPromptState {
  open: boolean;
  notice: string | null;
  resumes: Array<() => void>;
  notifyExpired: (notice?: string) => void;
  addResume: (fn: () => void) => void;
  succeed: () => void;
  dismiss: () => void;
  abandon: () => void;
  reset: () => void;
}

export const useAuthPromptStore = create<AuthPromptState>((set, get) => ({
  open: false,
  notice: null,
  resumes: [],

  notifyExpired: (notice) => {
    set({ open: true, notice: notice ?? SESSION_EXPIRED_MESSAGE });
  },

  addResume: (fn) => set((s) => ({ resumes: [...s.resumes, fn] })),

  succeed: () => {
    set({ open: false, resumes: [], notice: null });
  },

  dismiss: () => {
    if (!get().open) return;
    set({ open: false, resumes: [], notice: null });
  },

  abandon: () => {
    if (!get().open) return;
    set({ open: false, resumes: [], notice: null });
    useAuthStore.getState().clearSession();
  },

  reset: () => set({ open: false, resumes: [], notice: null }),
}));
