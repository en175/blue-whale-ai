import { create } from 'zustand';
import type { AppState } from '@/custom/types';

interface AppActions {
  setActiveMenu: (menu: string) => void;
  toggleSidebar: () => void;
}

type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>((set) => ({
  activeMenu: 'home',
  sidebarCollapsed: false,

  setActiveMenu: (menu: string) => set({ activeMenu: menu }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
