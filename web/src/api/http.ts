/* ============================================
 * http 统一请求封装
 * - 产品：{code:200, data, msg}；code===200 解包 data，否则抛 ApiError（文案取 msg）并默认 toast
 * - 后台：{success:true, data} 仍兼容
 * - 登录态：JWT 由前端保管，这里统一注入 `Authorization`（IKJAZN）；非 auth 接口 401：
 *   已登录则弹窗续接，未登录才清会话
 * ============================================ */
import { toast } from 'sonner';
import { handleUnauthorized } from '@/utils/auth';
import { getSessionToken } from '@/api/sessionToken';

/** 接口路径前缀 */
export const API_PREFIX = '/api';
/** 请求在网络断开时不能无限挂起；页面可据此结束保存态或展示重试入口。 */
export const API_REQUEST_TIMEOUT_MS = 10_000;

/**
 * agent 计费查账端点。**它的 401 不代表本地登录失效，因此豁免自动登出**（审查 W·A12）。
 *
 * 这条链路是：浏览器 → BFF `/api/agent/billing/*` → new-api `/api/log/self`。BFF 把上游的
 * 状态码原样透传，异常过滤器也不改。于是上游一次计费打嗝（sk token 被拒、限流、维护）
 * 就变成本地 `setSession(null)`——**对话进行中用户被静默登出**，而积分那段代码只
 * `console.warn`，界面上毫无提示，用户要到下次跳转才发现。
 *
 * 上游的计费状态码不该被洗成 BFF 自己的鉴权状态。查不到账的正确表现是胶囊显示「—」，
 * 那条路已经通了（IKAFPC / 审查 W·P1）。
 */
const AGENT_BILLING_PREFIX = `${API_PREFIX}/agent/billing/`;

/** 真实后端地址（代理目标，来自 .env.[mode] 的 VITE_API_BASE_URL），仅用于控制台日志 */
const BACKEND_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;

export class ApiError extends Error {
  status: number;
  code: number | string;
  /** 失败信封 data；画布 412 会带回 { version } 供刷新 If-Match */
  data: unknown;

  constructor(status: number, message: string, code: number | string = '', data: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** IKJFGQ：失败信封 data 里的 canonical 字符串码（如 task_type_param_constraint）——数值码会因撞号
 *  重排（1060 已改过一次），字符串码是稳定锚点，识别方优先取它，数值 e.code 留兜底。
 *  创建 4xx 与异步任务详情失败信封两处 data.code 均携带字符串码。 */
export function envelopeErrorCode(e: ApiError): number | string {
  const c = (e.data as { code?: unknown } | null | undefined)?.code;
  return typeof c === 'string' ? c : e.code;
}

/** 在标准 fetch init 上增加 silent：失败仍抛 ApiError，但不 toast（轮询/水合/登录探测）。 */
export type ApiRequestInit = RequestInit & { silent?: boolean };

/** silent init 片段（IKI8KZ 审查收拢）：显式 true 才携带 silent，缺省不 silent。
 *  供调用点 spread 进 apiRequest init（jobs/assets 家族 13 处同构展开）或整只作为
 *  silent 型 init 实参（upload 工具透传）；口径与原手写展开一致，不改缺省行为。 */
export function silentInit(init?: { silent?: boolean }): { silent?: true } {
  return init?.silent === true ? { silent: true } : {};
}

function toFetchInit(init?: ApiRequestInit): RequestInit | undefined {
  if (!init) return undefined;
  const { silent: _silent, ...rest } = init;
  return rest;
}

interface Envelope<T> {
  code?: number;
  success?: boolean;
  msg?: string | null;
  message?: string;
  /** 后台 AdminException 失败包络：{ success:false, error } */
  error?: string;
  /** 包络级警告（后台侧同步 Go 折扣失败等场景返回，成功时可选） */
  warning?: string;
  data: T | null;
}

/** 失败文案：产品 msg，其次 message / 后台 error。 */
export function readApiErrorMessage(
  body: Pick<Envelope<unknown>, 'msg' | 'message' | 'error'> | undefined,
  status: number,
): string {
  for (const value of [body?.msg, body?.message, body?.error]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return `请求失败（${status}）`;
}

/** 基础 fetch：附加 Content-Type（登录态走 HttpOnly cookie），处理 401 会话失效 */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  // 开发模式控制台打印真实后端完整路径（代理目标 + 请求路径）
  if (import.meta.env.DEV) {
    const realUrl = BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
    console.info(`[api] ${init?.method ?? 'GET'} ${realUrl}`);
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  // 登录凭证：JWT 由前端保管，统一在这里注入（IKJAZN）。调用方显式传了就不覆盖。
  // 迁移期后端**同时接受请求头与 cookie**，所以没有令牌时不必拦——老会话仍走得通。
  const token = getSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const timeoutController = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => timeoutController.abort(init?.signal?.reason);
  if (init?.signal) {
    if (init.signal.aborted) onExternalAbort();
    else init.signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, API_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, signal: timeoutController.signal });
  } catch (error) {
    if (timedOut) throw new ApiError(408, '请求超时，请稍后重试', 408);
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    init?.signal?.removeEventListener('abort', onExternalAbort);
  }

  // 凭证失效：已登录则弹登录续接，未登录才清会话（auth 类接口除外，避免登录失败误清；
  // admin/session 对非管理员返回 401 属正常业务结果，同样豁免；
  // agent 计费查账把**上游 new-api 的状态码原样透传**，那个 401 说的是"上游拒了这张
  // sk token"，不是"你在蓝鲸的登录失效了"——见下方 BILLING_PREFIX 的说明）
  if (
    res.status === 401 &&
    !path.startsWith(`${API_PREFIX}/auth/`) &&
    !path.startsWith(AGENT_BILLING_PREFIX) &&
    path !== `${API_PREFIX}/admin/session`
  ) {
    handleUnauthorized();
  }
  return res;
}

/** GET 在途去重：同 key（方法+路径+头+体）并发只发一次请求（StrictMode 开发模式双挂载等场景），
 * 共享解析结果；完成（成功/失败）后释放，再次调用重新请求。
 * 在结果层而非 Response 层去重，避免响应体只能消费一次的问题 */
const inflight = new Map<string, Promise<{ data: unknown; warning?: string }>>();

function dedupKey(path: string, init?: ApiRequestInit): string {
  const fetchInit = toFetchInit(init);
  const headers = new Headers(fetchInit?.headers);
  const headerStr = [...headers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return `${path}|${headerStr}|${fetchInit?.body ?? ''}`;
}

/** 单次请求 + 包络解析：成功返回 data；失败抛 ApiError，默认 toast(msg) */
async function doRequest<T>(path: string, init?: ApiRequestInit): Promise<{ data: T; warning?: string }> {
  const silent = init?.silent === true;
  let res: Response;
  try {
    res = await apiFetch(path, toFetchInit(init));
  } catch (error) {
    const err = isApiError(error)
      ? error
      : new ApiError(0, '网络请求失败，请检查网络后重试');
    if (!silent) toast.error(err.message);
    throw err;
  }
  const body = (await res.json().catch(() => undefined)) as Envelope<T> | undefined;

  const ok = body !== undefined && (body.code === 200 || body.success === true);
  if (!res.ok || !ok) {
    const err = new ApiError(
      res.status,
      readApiErrorMessage(body, res.status),
      body?.code ?? res.status,
      body?.data,
    );
    if (!silent && err.status !== 401) toast.error(err.message);
    throw err;
  }
  return { data: body.data as T, warning: body.warning };
}

/** 统一请求（附带包络级 warning）：GET 在途去重，写操作每次实发 */
export async function apiRequestWithMeta<T>(
  path: string,
  init?: ApiRequestInit
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

/** 统一请求：成功返回 data，失败抛 ApiError（默认 toast msg） */
export async function apiRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { data } = await apiRequestWithMeta<T>(path, init);
  return data;
}

/** 常用方法快捷入口；init.silent 失败不 toast */
export const http = {
  get: <T>(path: string, init?: ApiRequestInit) => apiRequest<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body?: unknown, init?: ApiRequestInit) =>
    apiRequest<T>(path, {
      ...init,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown, init?: ApiRequestInit) =>
    apiRequest<T>(path, {
      ...init,
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown, init?: ApiRequestInit) =>
    apiRequest<T>(path, {
      ...init,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string, init?: ApiRequestInit) => apiRequest<T>(path, { ...init, method: 'DELETE' }),
};
