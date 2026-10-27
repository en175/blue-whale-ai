import { create } from 'zustand';

interface LoginDialogState {
  open: boolean;
  returnTo: string | null;
  notice: string | null;
  openLogin: (options?: { returnTo?: string; notice?: string }) => void;
  closeLogin: () => void;
}

export const useLoginDialogStore = create<LoginDialogState>((set) => ({
  open: false,
  returnTo: null,
  notice: null,
  openLogin: (options) => set({ open: true, returnTo: options?.returnTo ?? null, notice: options?.notice ?? null }),
  closeLogin: () => set({ open: false, returnTo: null, notice: null }),
}));
