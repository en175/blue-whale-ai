import { create } from 'zustand';
import type { AppState } from '@/types';

interface AppActions {
  setActiveMenu: (menu: string) => void;
  toggleSidebar: () => void;
}

type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>((set) => ({
  // State
  activeMenu: 'home',
  sidebarCollapsed: false,

  // Actions
  setActiveMenu: (menu: string) => set({ activeMenu: menu }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
