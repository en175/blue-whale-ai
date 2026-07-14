"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PendingAction, User } from "./types";
import { clearUser, clearTokens, loadAccessToken, loadRefreshToken, loadUser, saveTokens, saveUser, SKIP_AUTH, MOCK_USER } from "./authStorage";
import { loginWithCode, logoutApi, refreshToken, updateUsername as updateUsernameApi, changePhone as changePhoneApi, ApiError } from "@/lib/auth";
import { subscribeToAuthFailure, getAccessTokenSilently } from "@/lib/api-client";
import { LoginModal } from "./LoginModal";
import { resolveUserId, rebindPhone } from "./userId";

interface AuthContextValue {
  user: User | null;
  isLoginOpen: boolean;
  pendingAction: PendingAction | null;
  requireAuth: (action: PendingAction, run: () => void) => void;
  signIn: (phone: string, code: string) => Promise<void>;
  signOut: () => void;
  openLogin: () => void;
  closeLogin: () => void;
  updateUsername: (username: string) => Promise<void>;
  changePhone: (newPhone: string, code: string) => Promise<void>;
  updateAvatar: (url: string) => void;
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
  const hasMountedRef = useRef(false); // StrictMode 下 useEffect 双重火守卫

  // mount: 尝试用 refresh_token 恢复完整 session
  useEffect(() => {
    // 本地开发：跳过鉴权，直接注入占位用户，不走 refresh 流程
    if (SKIP_AUTH) {
      setUser(MOCK_USER);
      return;
    }
    const u = loadUser();

    // 乐观：有 user 数据立刻恢复 UI 登录态，不等刷新结果
    if (u) setUser(u);

    // 如果 ref 已标记（StrictMode 双重火），跳过第二次 refresh 请求
    const rt = u ? loadRefreshToken() : null;
    if (!u || !rt) return;
    if (hasMountedRef.current) {
      console.log("[Auth] mount: hasMountedRef=true，跳过重复 refresh");
      return;
    }
    hasMountedRef.current = true;
    console.log("[Auth] mount: 发送 refresh 请求...");

    // 后台静默换新 token
    refreshToken(rt)
      .then((data) => {
        const uid = resolveUserId(data.phone);
        const avatar = data.avatar && data.avatar !== "0" ? data.avatar : undefined;
        saveTokens(data.access_token, data.refresh_token);
        saveUser({ userId: data.user_id, uid, username: data.username, phone: data.phone, avatar });
        setUser({ userId: data.user_id, uid, username: data.username, phone: data.phone, avatar });
      })
      .catch((e) => {
        // 仅当存储中 RT 仍是同一份时才处理，避免竞态误伤新登录
        const currentRt = loadRefreshToken();
        if (currentRt !== rt) return;

        // 只有后端明确 401（token 无效/已轮换）才清 tokens
        // 网络错误 / 后端未启动 → 保留本地登录态，下次操作时 api-client 自动重试
        if (e instanceof ApiError && e.code === 401) {
          console.warn("[Auth] mount refresh → 后端 401，清理 tokens", e.message);
          clearTokens();
        } else {
          console.warn("[Auth] mount refresh 失败但保留登录态", e instanceof Error ? e.message : e);
        }
        // 无论如何，user 保留（乐观恢复的 UI 仍可展示）
      });
  }, []);

  // 订阅 API 层通知：401 后 refresh 也失败 → 清空状态，弹出登录
  useEffect(() => {
    return subscribeToAuthFailure(() => {
      console.warn("[Auth] onAuthFailure 触发 → 清空全部状态 + 弹登录");
      setUser(null);
      clearTokens();
      clearUser();
      setPendingAction(null);
      executorRef.current = null;
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
      if (SKIP_AUTH) { run(); return; }
      // 已在内存中有 user → 直接放行
      if (user) { run(); return; }

      // 尝试从 storage 恢复 + 静默刷新 token
      const stored = loadUser();
      if (stored) {
        const at = loadAccessToken();
        if (at) { setUser(stored); run(); return; }
        // 无 access token → 尝试 refresh
        const token = await getAccessTokenSilently();
        if (token) { setUser(stored); run(); return; }
      }

      // 兜底：弹出登录
      setPendingAction(action);
      executorRef.current = run;
      setLoginOpen(true);
    },
    [user],
  );

  const signIn = useCallback(async (phone: string, code: string) => {
    setAuthLoading(true);
    try {
      const data = await loginWithCode(phone, code);
      const uid = resolveUserId(phone);
      const avatar = data.avatar && data.avatar !== "0" ? data.avatar : undefined;
      const u: User = { userId: data.user_id, uid, username: data.username, phone: data.phone, avatar };
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

  const updateUsername = useCallback(async (username: string) => {
    await updateUsernameApi(username);
    setUser((prev) => {
      if (!prev) return null;
      const updated = { ...prev, username };
      saveUser(updated);
      return updated;
    });
  }, []);

  const changePhone = useCallback(async (newPhone: string, code: string) => {
    await changePhoneApi(newPhone, code);
    setUser((prev) => {
      if (!prev) return null;
      rebindPhone(prev.phone, newPhone, prev.uid);
      const updated = { ...prev, phone: newPhone };
      saveUser(updated);
      return updated;
    });
  }, []);

  const updateAvatar = useCallback((url: string) => {
    setUser((prev) => {
      if (!prev) return null;
      const updated = { ...prev, avatar: url };
      saveUser(updated);
      return updated;
    });
  }, []);

  const value: AuthContextValue = {
    user, isLoginOpen, pendingAction,
    requireAuth, signIn, signOut, openLogin, closeLogin, updateUsername, changePhone, updateAvatar,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {isLoginOpen && <LoginModal onClose={closeLogin} />}
    </Ctx.Provider>
  );
}