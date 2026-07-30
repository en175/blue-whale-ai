"use client";

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
import {
  clearUser,
  clearTokens,
  loadAccessToken,
  loadUser,
  saveTokens,
  saveUser,
  SKIP_AUTH,
  MOCK_USER,
} from "./authStorage";
import {
  loginWithPassword,
  registerWithPassword,
  fetchMe,
  type RegisterInput,
} from "@/lib/auth";
import { apiRequest } from "@/lib/api-client";
import {
  subscribeToAuthFailure,
  getAccessTokenSilently,
} from "@/lib/api-client";
import { LoginModal } from "./LoginModal";

interface AuthContextValue {
  user: User | null;
  isLoginOpen: boolean;
  pendingAction: PendingAction | null;
  requireAuth: (action: PendingAction, run: () => void) => void;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  signOut: () => void;
  /** 从后端拉最新用户信息并同步本地。换绑成功后用（手机号变更需后端确认）。改昵称不用——用 updateLocalUser（乐观更新）。 */
  refreshUser: () => Promise<void>;
  /** 轻量同步：直接 patch 本地 user + storage，不调后端。改昵称成功后用（刚 PUT 成功无需再 GET）。 */
  updateLocalUser: (patch: Partial<User>) => void;
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
  const [user, setUser] = useState<User | null>(() =>
    SKIP_AUTH ? MOCK_USER : null,
  );
  const [isLoginOpen, setLoginOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const executorRef = useRef<(() => void) | null>(null);

  // Keep SSR and the first browser render identical, then restore local MVP state.
  useEffect(() => {
    if (SKIP_AUTH) return;
    const timer = window.setTimeout(() => {
      const stored = loadUser();
      if (stored) setUser(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 订阅 API 层通知：401 后 refresh 也失败 → 清空状态，弹出登录
  useEffect(() => {
    return subscribeToAuthFailure(() => {
      console.warn("[Auth] onAuthFailure 触发 → 清空全部状态 + 弹登录");
      setUser(null);
      clearTokens();
      clearUser();
      setLoginOpen(true);
    });
  }, []);

  const openLogin = useCallback(() => setLoginOpen(true), []);
  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    setPendingAction(null);
    executorRef.current = null;
  }, []);

  const requireAuth = useCallback(
    async (action: PendingAction, run: () => void) => {
      // 本地开发跳过鉴权时直接放行
      if (SKIP_AUTH) {
        run();
        return;
      }
      // 已在内存中有 user → 直接放行
      if (user) {
        run();
        return;
      }

      // 尝试从 storage 恢复 + 静默刷新 token
      const stored = loadUser();
      if (stored) {
        const at = loadAccessToken();
        if (at) {
          setUser(stored);
          run();
          return;
        }
        // 无 access token → 尝试 refresh
        const token = await getAccessTokenSilently();
        if (token) {
          setUser(stored);
          run();
          return;
        }
      }

      // 兜底：弹出登录
      setPendingAction(action);
      executorRef.current = run;
      setLoginOpen(true);
    },
    [user],
  );

  const signIn = useCallback(async (username: string, password: string) => {
    try {
      const data = await loginWithPassword(username, password);

      // 先存 token，apiRequest 从 storage 读取
      saveTokens(data.access_token, data.refresh_token);

      // 登录后拉取配额
      let credits: number | undefined;
      try {
        const usage = await apiRequest<{ quota: number }>("/api/usage/token");
        credits = usage.quota;
      } catch {
        // 静默失败，credits 保持 undefined
      }

      const u: User = {
        userId: data.user_id,
        username: data.username,
        phone: data.phone ?? "",
        hasPassword: data.has_password,
        credits,
      };
      saveUser(u);
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
    }
  }, []);

  const signUp = useCallback(async (input: RegisterInput) => {
    const data = await registerWithPassword(input);
    saveTokens(data.access_token, data.refresh_token);
    // 注册后同样拉取配额，与 signIn 对称
    let credits: number | undefined;
    try {
      const usage = await apiRequest<{ quota: number }>("/api/usage/token");
      credits = usage.quota;
    } catch {
      // 静默失败
    }
    const u: User = {
      userId: data.user_id,
      username: data.username,
      phone: data.phone ?? "",
      hasPassword: data.has_password,
      credits,
    };
    saveUser(u);
    saveTokens(data.access_token, data.refresh_token);
    setUser(u);
    setLoginOpen(false);
    const exec = executorRef.current;
    if (exec) {
      executorRef.current = null;
      setPendingAction(null);
      exec();
    }
  }, []);

  const signOut = useCallback(() => {
    clearUser();
    clearTokens();
    setUser(null);
    setPendingAction(null);
    executorRef.current = null;
    if (pathname?.startsWith("/canvas")) router.replace("/");
  }, [pathname, router]);

  // 从后端拉最新用户信息并同步本地（改昵称/换绑成功后调用）
  const refreshUser = useCallback(async () => {
    if (SKIP_AUTH) return; // 本地开发模式无后端，跳过
    const info = await fetchMe();
    let credits: number | undefined;
    try {
      const usage = await apiRequest<{ quota: number }>("/api/usage/token");
      credits = usage.quota;
    } catch {
      // 静默
    }
    const u: User = {
      userId: info.user_id,
      username: info.username,
      phone: info.phone,
      hasPassword: info.has_password,
      credits,
    };
    saveUser(u);
    setUser(u);
  }, []);

  // 轻量同步：直接 patch 本地 user + storage，不调后端
  const updateLocalUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveUser(next);
      return next;
    });
  }, []);

  const value: AuthContextValue = {
    user,
    isLoginOpen,
    pendingAction,
    requireAuth,
    signIn,
    signUp,
    signOut,
    refreshUser,
    updateLocalUser,
    openLogin,
    closeLogin,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {isLoginOpen && <LoginModal onClose={closeLogin} />}
    </Ctx.Provider>
  );
}
