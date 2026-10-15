import { create } from 'zustand';

interface RechargeUiState {
  open: boolean;
  openRecharge: () => void;
  closeRecharge: () => void;
}

export const useRechargeUiStore = create<RechargeUiState>((set) => ({
  open: false,
  openRecharge: () => set({ open: true }),
  closeRecharge: () => set({ open: false }),
}));
