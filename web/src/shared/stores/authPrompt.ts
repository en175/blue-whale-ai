import { create } from 'zustand';
import { useAuthStore } from '@/stores/auth';

interface AuthPromptState {
  open: boolean;
  resumes: Array<() => void>;
  notifyExpired: () => void;
  addResume: (fn: () => void) => void;
  succeed: () => void;
  abandon: () => void;
  reset: () => void;
}

export const useAuthPromptStore = create<AuthPromptState>((set, get) => ({
  open: false,
  resumes: [],

  notifyExpired: () => {
    if (get().open) return;
    set({ open: true });
  },

  addResume: (fn) => set((s) => ({ resumes: [...s.resumes, fn] })),

  succeed: () => {
    const resumes = get().resumes;
    set({ open: false, resumes: [] });
    for (const fn of resumes) fn();
  },

  abandon: () => {
    if (!get().open) return;
    set({ open: false, resumes: [] });
    useAuthStore.getState().clearSession();
  },

  reset: () => set({ open: false, resumes: [] }),
}));
