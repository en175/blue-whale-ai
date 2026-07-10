/**
 * API Client — 基于 fetch 的双 Token 自动刷新封装。
 *
 * 特性：
 * - 请求自动附带 Authorization: Bearer <access_token>
 * - 收到 401 → 单例锁 + 请求队列，静默刷新 token
 * - 刷新成功 → 重放队列中所有请求，用户无感
 * - 刷新失败 → 清空 tokens，通知 AuthContext 弹出登录
 * - 跳过 auth 端点（/api/auth/*），避免无限循环
 */
import {
  loadAccessToken,
  loadRefreshToken,
  saveTokens,
  clearTokens,
} from "@/components/auth/authStorage";
import type { LoginData } from "./auth";

// ---------------------------------------------------------------------------
// Singleton lock & request queue
// ---------------------------------------------------------------------------

let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;

type QueueItem = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
};
let failedQueue: QueueItem[] = [];

// ---------------------------------------------------------------------------
// Auth failure callback
// ---------------------------------------------------------------------------

type AuthFailureHandler = () => void;
let onAuthFailure: AuthFailureHandler | null = null;

/** 注册认证失败回调（refresh token 也过期 → 需要重新登录）。返回取消订阅函数。 */
export function subscribeToAuthFailure(handler: AuthFailureHandler): () => void {
  onAuthFailure = handler;
  return () => {
    onAuthFailure = null;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function processQueue(error: Error | null, token?: string) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  failedQueue = [];
}

/** auth 端点不触发 401 拦截，防止 refresh 自身 401 导致无限循环。 */
function isAuthEndpoint(url: string): boolean {
  const authPaths = [
    "/api/auth/captcha",
    "/api/auth/send-code",
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/logout",
  ];
  return authPaths.some((p) => url.includes(p));
}

/** 调用后端 /api/auth/refresh，返回新的 access_token。不经过 apiFetch 自身。 */
async function doRefreshToken(): Promise<string> {
  const rt = loadRefreshToken();
  if (!rt) throw new Error("No refresh token");

  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rt}`,
    },
  });

  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);

  const json = await res.json();
  if (!json || json.code !== 200) {
    throw new Error(json?.msg ?? "Refresh token 已过期");
  }

  const data = json.data as LoginData;
  saveTokens(data.access_token, data.refresh_token);
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 带 401 自动刷新的 fetch 封装。
 * 用法同 fetch，自动附加 Authorization 头，401 时自动刷新 token 并重试。
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const makeRequest = (token?: string | null): Promise<Response> => {
    const headers = new Headers(options.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(url, { ...options, headers });
  };

  // 首次请求
  const accessToken = loadAccessToken();
  let res = await makeRequest(accessToken);

  // 非 401 / 是 auth 端点 → 直接返回
  if (res.status !== 401 || isAuthEndpoint(url)) {
    return res;
  }

  // 401 on 受保护端点 → 启动刷新（单例）
  if (!isRefreshing) {
    isRefreshing = true;
    refreshPromise = doRefreshToken()
      .then((token) => {
        processQueue(null, token);
        return token;
      })
      .catch((err) => {
        processQueue(err);
        console.warn("[api-client] apiFetch 401 → refresh 也失败，清理 tokens", err instanceof Error ? err.message : err);
        clearTokens();
        onAuthFailure?.();
        throw err;
      })
      .finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
  }

  // 等待刷新完成（正在进行的或刚启动的）
  try {
    const newToken = await refreshPromise;
    res = await makeRequest(newToken);
  } catch {
    throw new Error("认证已过期，请重新登录");
  }

  return res;
}

/**
 * 便捷方法：apiFetch + 解析统一 Result 结构 { code, msg, data }。
 * code === 200 → 返回 data；否则抛 Error(msg)。
 */
export async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(url, options);
  } catch {
    throw new Error("后端未启动或无法连接");
  }

  if (!res.ok) {
    throw new Error(`请求失败: ${res.status}`);
  }

  let json: { code: number; msg?: string; data?: T };
  try {
    json = await res.json();
  } catch {
    throw new Error(`上游响应非 JSON（HTTP ${res.status}）`);
  }

  if (json.code !== 200) {
    throw new Error(json.msg || `上游错误 ${json.code}`);
  }

  return json.data as T;
}

/**
 * 静默获取有效 access token（无则尝试 refresh）。
 * 用于 requireAuth 等场景，失败返回 null 而非抛错。
 */
export async function getAccessTokenSilently(): Promise<string | null> {
  const at = loadAccessToken();
  if (at) return at;

  const rt = loadRefreshToken();
  if (!rt) return null;

  if (!isRefreshing) {
    isRefreshing = true;
    refreshPromise = doRefreshToken()
      .then((token) => {
        processQueue(null, token);
        return token;
      })
      .catch((err) => {
        processQueue(err);
        return null; // silent 模式：不抛错，不触发 onAuthFailure
      })
      .finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
  }

  // refreshPromise 可能由 apiFetch 发起（失败会 reject），这里兜底 catch
  try {
    return await refreshPromise;
  } catch {
    return null;
  }
}