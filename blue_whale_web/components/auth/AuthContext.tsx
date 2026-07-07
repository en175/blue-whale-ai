"use client";
/**
 * AuthContext —— 登录态 Context + Provider + useAuth hook。
 *
 * 项目首个 React Context（画布此前全 prop-drilling）。
 * - user 初值 null（SSR 一致），mount effect 从 localStorage 恢复（抄 projectStore 范式）。
 * - requireAuth(action, run)：已登录立即 run；未登录存 pendingAction + executorRef 并开 modal。
 * - signIn：mock 生成用户名 + 持久化 + 关 modal + 同 tick 回放 executor。
 * - signOut：清存储 + 清 state + 清 pending；若在 /canvas 跳首页。
 * - LoginModal 全局唯一，内挂在 Provider。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PendingAction, User } from "./types";
import { clearUser, loadUser, saveUser } from "./authStorage";
import { generateUsername } from "./userName";
import { LoginModal } from "./LoginModal";

interface AuthContextValue {
  user: User | null;
  isLoginOpen: boolean;
  pendingAction: PendingAction | null;
  requireAuth: (action: PendingAction, run: () => void) => void;
  signIn: (phone: string) => void;
  signOut: () => void;
  openLogin: () => void;
  closeLogin: () => void;
}

const Ctx = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth 必须在 <AuthProvider> 内使用");
  return v;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [isLoginOpen, setLoginOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  // executor 不进 state：闭包不可序列化、仅运行时回放
  const executorRef = useRef<(() => void) | null>(null);

  // mount 恢复（SSR 安全：user 初值 null 避免 hydration mismatch，client mount 后读 localStorage）
  // set-state-in-effect 是 localStorage 恢复的必要例外（抄 projectStore.ts 范式）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(loadUser());
  }, []);

  const openLogin = useCallback(() => setLoginOpen(true), []);

  const closeLogin = useCallback(() => {
    // 关 modal = 放弃：清 pending + 清 executor
    setLoginOpen(false);
    setPendingAction(null);
    executorRef.current = null;
  }, []);

  const requireAuth = useCallback(
    (action: PendingAction, run: () => void) => {
      // 首帧窄窗 fallback：user state 可能尚未从 localStorage 恢复，直读双保险
      if (user) {
        run();
        return;
      }
      const stored = loadUser();
      if (stored) {
        setUser(stored);
        run();
        return;
      }
      // 未登录：存 action + executor，开 modal
      setPendingAction(action);
      executorRef.current = run;
      setLoginOpen(true);
    },
    [user]
  );

  const signIn = useCallback((phone: string) => {
    const u: User = { username: generateUsername(), phone };
    saveUser(u);
    setUser(u);
    setLoginOpen(false);
    // 登录成功同 tick 回放被拦动作
    const exec = executorRef.current;
    if (exec) {
      executorRef.current = null;
      setPendingAction(null);
      exec();
    }
  }, []);

  const signOut = useCallback(() => {
    clearUser();
    setUser(null);
    setPendingAction(null);
    executorRef.current = null;
    // 画布是登录态才能进；退出后踢回首页
    if (pathname?.startsWith("/canvas")) router.replace("/");
  }, [pathname, router]);

  const value: AuthContextValue = {
    user,
    isLoginOpen,
    pendingAction,
    requireAuth,
    signIn,
    signOut,
    openLogin,
    closeLogin,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {isLoginOpen && <LoginModal onClose={closeLogin} onSuccess={signIn} />}
    </Ctx.Provider>
  );
}
