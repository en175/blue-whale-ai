import { toast } from 'sonner';
import { handleUnauthorized } from '@/shared/utils/auth';
import { getSessionToken } from '@/shared/api/sessionToken';

export const API_PREFIX = '/api';
export const API_REQUEST_TIMEOUT_MS = 10_000;

const BACKEND_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;

export class ApiError extends Error {
  status: number;
  code: number | string;
  data: unknown;
  errorCode?: string;

  constructor(
    status: number,
    message: string,
    code: number | string = '',
    data: unknown = null,
    errorCode?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
    this.errorCode = errorCode;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function envelopeErrorCode(e: ApiError): number | string {
  const c = (e.data as { code?: unknown } | null | undefined)?.code;
  return typeof c === 'string' ? c : e.code;
}

export type ApiRequestInit = RequestInit & { silent?: boolean };

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
  error?: string;
  error_code?: string;
  warning?: string;
  data: T | null;
}

export function readApiErrorMessage(
  body: Pick<Envelope<unknown>, 'msg' | 'message' | 'error'> | undefined,
  status: number,
): string {
  for (const value of [body?.msg, body?.message, body?.error]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return `请求失败（${status}）`;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (import.meta.env.DEV) {
    const realUrl = BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
    console.info(`[api] ${init?.method ?? 'GET'} ${realUrl}`);
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
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

  if (
    res.status === 401 &&
    !path.startsWith(`${API_PREFIX}/auth/`) &&
    path !== `${API_PREFIX}/admin/session`
  ) {
    handleUnauthorized();
  }
  return res;
}

const inflight = new Map<string, Promise<{ data: unknown; warning?: string }>>();

function dedupKey(path: string, init?: ApiRequestInit): string {
  const fetchInit = toFetchInit(init);
  const headers = new Headers(fetchInit?.headers);
  const headerStr = [...headers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return `${path}|${headerStr}|${fetchInit?.body ?? ''}`;
}

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
      typeof body?.error_code === 'string' ? body.error_code : undefined,
    );
    if (!silent && err.status !== 401) toast.error(err.message);
    throw err;
  }
  return { data: body.data as T, warning: body.warning };
}

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

export async function apiRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { data } = await apiRequestWithMeta<T>(path, init);
  return data;
}

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

export interface PresignData {
  storage_key: string;
  upload_url: string;
  headers: Record<string, string>;
  expires_in: number;
}

export async function putToPresignedUrl(presign: PresignData, file: File) {
  if (!presign.upload_url) throw new Error('预签名上传地址为空');

  const uploadUrl = import.meta.env.DEV
    ? `/__tos-upload?url=${encodeURIComponent(presign.upload_url)}`
    : presign.upload_url;

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: presign.headers,
    body: file,
  });
  if (!res.ok) throw new Error(`直传对象存储失败（${res.status}）`);
}
