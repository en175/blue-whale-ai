"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PendingAction, User } from "./types";
import { clearUser, clearTokens, loadAccessToken, loadRefreshToken, loadUser, saveTokens, saveUser } from "./authStorage";
import { loginWithCode, logoutApi, refreshToken, ApiError } from "@/lib/auth";
import { LoginModal } from "./LoginModal";

interface AuthContextValue {
  user: User | null;
  isLoginOpen: boolean;
  pendingAction: PendingAction | null;
  requireAuth: (action: PendingAction, run: () => void) => void;
  signIn: (phone: string, code: string) => Promise<void>;
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
  const [authLoading, setAuthLoading] = useState(false);
  const executorRef = useRef<(() => void) | null>(null);

  // mount 恢复
  useEffect(() => {
    const u = loadUser();
    if (u) {
      // 尝试用 refresh_token 恢复 session
      const rt = loadRefreshToken();
      if (rt) {
        refreshToken(rt).then((data) => {
          saveTokens(data.access_token, data.refresh_token);
          saveUser({ userId: data.user_id, username: data.username, phone: data.phone });
          setUser({ userId: data.user_id, username: data.username, phone: data.phone });
        }).catch(() => {
          // refresh 失败，清掉
          clearUser();
          clearTokens();
        });
      } else {
        setUser(u);
      }
    }
  }, []);

  const openLogin = useCallback(() => setLoginOpen(true), []);
  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    setPendingAction(null);
    executorRef.current = null;
  }, []);

  const requireAuth = useCallback(
    (action: PendingAction, run: () => void) => {
      if (user) { run(); return; }
      const stored = loadUser();
      const at = loadAccessToken();
      if (stored && at) { setUser(stored); run(); return; }
      setPendingAction(action);
      executorRef.current = run;
      setLoginOpen(true);
    },
    [user]
  );

  const signIn = useCallback(async (phone: string, code: string) => {
    setAuthLoading(true);
    try {
      const data = await loginWithCode(phone, code);
      const u: User = { userId: data.user_id, username: data.username, phone: data.phone };
      saveUser(u);
      saveTokens(data.access_token, data.refresh_token);
      setUser(u);
      setLoginOpen(false);
      // 回放被拦动作
      const exec = executorRef.current;
      if (exec) {
        executorRef.current = null;
        setPendingAction(null);
        exec();
      }
    } catch (e) {
      throw e; // 抛给 LoginModal 展示
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const signOut = useCallback(() => {
    const rt = loadRefreshToken();
    if (rt) logoutApi(rt).catch(() => { /* ignore */ });
    clearUser();
    clearTokens();
    setUser(null);
    setPendingAction(null);
    executorRef.current = null;
    if (pathname?.startsWith("/canvas")) router.replace("/");
  }, [pathname, router]);

  const value: AuthContextValue = {
    user, isLoginOpen, pendingAction,
    requireAuth, signIn, signOut, openLogin, closeLogin,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {isLoginOpen && <LoginModal onClose={closeLogin} />}
    </Ctx.Provider>
  );
}
