/* ============================================
 * 会话过期登录门：401 时弹登录并登记续接，放弃才清本地会话
 * ============================================ */
import { create } from 'zustand';
import { useAuthStore } from '@/stores/auth';

interface AuthPromptState {
  /** 是否因会话过期弹出登录窗 */
  open: boolean;
  /** 登录成功后要重放的原动作（如画布生成） */
  resumes: Array<() => void>;
  /** 本地已有用户时标记过期并弹窗；可重复调用，只打开一次 */
  notifyExpired: () => void;
  /** 登记登录成功后要续接的动作 */
  addResume: (fn: () => void) => void;
  /** 登录成功：关窗并执行续接 */
  succeed: () => void;
  /** 放弃登录：关窗、丢掉续接、清本地会话 */
  abandon: () => void;
  /** 测试重置（不清会话） */
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
