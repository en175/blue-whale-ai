/* ============================================
 * http 统一请求封装：兼容后端两种响应包络
 * - 用户侧：{code:200, msg, data}
 * - 后台侧：{success:true, data}
 * - 自动附加 Bearer token；非 auth 接口 401 时清空本地会话
 * - 开发期 /api 前缀由 vite 代理转发到测试环境
 * ============================================ */
import { getAccessToken, setSession } from '@/utils/auth';

/** 接口路径前缀 */
export const API_PREFIX = '/api';

/** 真实后端地址（代理目标，来自 .env.[mode] 的 VITE_API_BASE_URL），仅用于控制台日志 */
const BACKEND_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;

export class ApiError extends Error {
  status: number;
  code: number | string;

  constructor(status: number, message: string, code: number | string = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

interface Envelope<T> {
  code?: number;
  success?: boolean;
  msg?: string | null;
  message?: string;
  /** 包络级警告（后台侧同步 Go 折扣失败等场景返回，成功时可选） */
  warning?: string;
  data: T | null;
}

/** 基础 fetch：附加 Content-Type 与 Authorization，处理 401 会话失效 */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  // 开发模式控制台打印真实后端完整路径（代理目标 + 请求路径）
  if (import.meta.env.DEV) {
    const realUrl = BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
    console.info(`[api] ${init?.method ?? 'GET'} ${realUrl}`);
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });

  // 凭证失效：清空本地会话（auth 类接口除外，避免登录失败误清；
  // admin/session 对非管理员返回 401 属正常业务结果，同样豁免）
  if (
    res.status === 401 &&
    !path.startsWith(`${API_PREFIX}/auth/`) &&
    path !== `${API_PREFIX}/admin/session`
  ) {
    setSession(null, null);
  }
  return res;
}

/** GET 在途去重：同 key（方法+路径+头+体）并发只发一次请求（StrictMode 开发模式双挂载等场景），
 * 共享解析结果；完成（成功/失败）后释放，再次调用重新请求。
 * 在结果层而非 Response 层去重，避免响应体只能消费一次的问题 */
const inflight = new Map<string, Promise<{ data: unknown; warning?: string }>>();

function dedupKey(path: string, init?: RequestInit): string {
  const headers = new Headers(init?.headers);
  const headerStr = [...headers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return `${path}|${headerStr}|${init?.body ?? ''}`;
}

/** 单次请求 + 包络解析：成功返回 data 与可选警告，失败抛 ApiError（msg 透传后端提示） */
async function doRequest<T>(path: string, init?: RequestInit): Promise<{ data: T; warning?: string }> {
  const res = await apiFetch(path, init);
  const body = (await res.json().catch(() => undefined)) as Envelope<T> | undefined;

  const ok = body !== undefined && (body.code === 200 || body.success === true);
  if (!res.ok || !ok) {
    throw new ApiError(
      res.status,
      body?.msg ?? body?.message ?? `请求失败（${res.status}）`,
      body?.code ?? res.status
    );
  }
  return { data: body.data as T, warning: body.warning };
}

/** 统一请求（附带包络级 warning）：GET 在途去重，写操作每次实发 */
export async function apiRequestWithMeta<T>(
  path: string,
  init?: RequestInit
): Promise<{ data: T; warning?: string }> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') return doRequest<T>(path, init);
  const key = dedupKey(path, init);
  const existing = inflight.get(key);
  if (existing) return existing as Promise<{ data: T; warning?: string }>;
  const p = doRequest<T>(path, init).finally(() => inflight.delete(key));
  inflight.set(key, p as Promise<{ data: unknown; warning?: string }>);
  return p;
}

/** 统一请求：成功返回 data，失败抛 ApiError（msg 透传后端提示） */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await apiRequestWithMeta<T>(path, init);
  return data;
}

/** 常用方法快捷入口 */
export const http = {
  get: <T>(path: string) => apiRequest<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, {
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};
