/**
 * API Client — 基于 fetch 的 new-api sk token 封装。
 *
 * 特性：
 * - 请求自动附带 Authorization: Bearer <access_token>
 * - 收到 401 → 清空 sk token，通知 AuthContext 弹出登录
 * - 跳过 auth 端点（/api/auth/*），避免无限循环
 */
import { loadAccessToken, clearTokens } from "@/components/auth/authStorage";
import { ApiError } from "./api/errors";

// ---------------------------------------------------------------------------
// Auth failure callback
// ---------------------------------------------------------------------------

type AuthFailureHandler = () => void;
let onAuthFailure: AuthFailureHandler | null = null;

/** 注册认证失败回调（凭证失效 → 需要重新登录）。返回取消订阅函数。 */
export function subscribeToAuthFailure(
  handler: AuthFailureHandler,
): () => void {
  onAuthFailure = handler;
  return () => {
    onAuthFailure = null;
  };
}

/** 凭证失效统一出口：清 token + 触发登录回调。未走 apiFetch 的请求层（如 lib/canvas.ts）401 时也调它。 */
export function notifyAuthFailure(): void {
  clearTokens();
  onAuthFailure?.();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** auth 端点不触发 401 拦截，防止认证入口自身 401 导致无限循环。 */
function isAuthEndpoint(url: string): boolean {
  const authPaths = [
    "/api/auth/captcha",
    "/api/auth/send-code",
    "/api/auth/login",
    "/api/auth/logout",
  ];
  return authPaths.some((p) => url.includes(p));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 带 new-api sk token 的 fetch 封装。
 * 用法同 fetch，自动附加 Authorization 头；401 时返回原响应并清理登录态。
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
  const res = await makeRequest(accessToken);

  if (res.status === 401 && !isAuthEndpoint(url)) {
    notifyAuthFailure();
  }
  return res;
}

/**
 * 便捷方法：apiFetch + 解析统一 Result 结构 { code, msg, data }。
 * code === 200 → 返回 data；否则抛 ApiError（保留稳定 code + request_id，IK2BCH）。
 */
type ResultEnvelope = {
  msg?: string;
  data?: {
    code?: string;
    message?: string;
    request_id?: string;
  };
};

/** 从 Result envelope 构造 ApiError：优先取 data.code/request_id，响应头 X-Request-Id 兜底。 */
function buildApiError(
  res: Response,
  envelope: ResultEnvelope | undefined,
  fallbackCode: string,
  fallbackMessage: string,
): ApiError {
  const data = envelope?.data;
  return new ApiError({
    status: res.status,
    code: data?.code ?? fallbackCode,
    message: envelope?.msg ?? data?.message ?? fallbackMessage,
    detail: data ?? envelope,
    requestId: data?.request_id ?? res.headers.get("X-Request-Id") ?? undefined,
  });
}

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

  // HTTP 4xx/5xx：尝试解析 Result envelope，保留稳定 code + request_id（IK2BCH）。
  if (!res.ok) {
    const envelope: ResultEnvelope | undefined = await res
      .json()
      .catch(() => undefined);
    throw buildApiError(
      res,
      envelope,
      `http_${res.status}`,
      `请求失败: ${res.status}`,
    );
  }

  let json: { code: number; msg?: string; data?: T };
  try {
    json = await res.json();
  } catch {
    throw new Error(`上游响应非 JSON（HTTP ${res.status}）`);
  }

  if (json.code !== 200) {
    // HTTP 200 业务失败：envelope 在 data 内。
    throw buildApiError(
      res,
      json as unknown as ResultEnvelope,
      String(json.code),
      json.msg ?? `上游错误 ${json.code}`,
    );
  }

  return json.data as T;
}

/**
 * 获取当前 sk token。没有 refresh 链路，缺失时返回 null。
 */
export async function getAccessTokenSilently(): Promise<string | null> {
  return loadAccessToken();
}
