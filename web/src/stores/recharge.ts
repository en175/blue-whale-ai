/* ============================================
 * 积分充值弹窗开关：用户菜单与生成前余额拦截共用
 * ============================================ */
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
