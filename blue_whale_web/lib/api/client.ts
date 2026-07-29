/**
 * client —— 基础 fetch 包装（IJZYVR API 客户端骨架）
 *
 * 对齐 BACKEND-API-PRD.md §4 通用约定:
 *   - 前缀 `/api`（可被 `baseUrl` 覆盖,便于测试）
 *   - 不发送浏览器侧 `X-User-Id`，服务端产品路由从 Authorization 解析身份
 *   - 业务错误体 `{ error: { code, message, detail } }` → ApiError
 *   - 非业务错误（无 error 段 / 非 JSON）→ 兜底 `http_<status>` code
 *   - 204 No Content → 返回 undefined
 *
 * 不收（保持 skeleton 边界）:
 *   - SSE 流式消费 — 走原生 fetch + ReadableStream,由业务方按 PRD §5 事件类型实现
 *   - 重试 / 退避 — P0 不承诺,失败直接抛
 *   - 运行时校验（zod）— 不引依赖
 */

import { ApiError } from "./errors";

const DEFAULT_BASE = "/api";

export type ApiFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** 测试 / 特殊部署用:覆盖 `/api` 前缀。 */
  baseUrl?: string;
};

function buildUrl(
  path: string,
  base: string,
  query?: ApiFetchOptions["query"],
): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  // base 可为空（绝对路径 path）、`/api`（相对路径）、`https://host/api`（绝对 URL）
  const baseClean =
    base.endsWith("/") && base.length > 1 ? base.slice(0, -1) : base;
  let url = base ? `${baseClean}${cleanPath}` : cleanPath;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `${url.includes("?") ? "&" : "?"}${qs}`;
  }
  return url;
}

/**
 * 主入口。返回 `Promise<T>`,失败抛 `ApiError`。
 *
 * 业务错误体形如 `{"error":{"code":"not_found","message":"...","detail":{}}}`;
 * 非 2xx 但无 error 段 → 抛 `ApiError(code="http_<status>", message=statusText)`。
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = "GET", body, query, signal, headers, baseUrl } = options;
  const base = baseUrl ?? DEFAULT_BASE;
  const url = buildUrl(path, base, query);

  const sanitizedHeaders = Object.fromEntries(
    Object.entries(headers ?? {}).filter(
      ([key]) => key.toLowerCase() !== "x-user-id",
    ),
  );
  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...sanitizedHeaders,
  };

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method,
    headers: finalHeaders,
    body: payload,
    signal,
  });

  // 204 No Content
  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("Content-Type") ?? "";
  const isJson = contentType.includes("application/json");
  const parsed: unknown = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const errBody =
      parsed &&
      typeof parsed === "object" &&
      "error" in (parsed as Record<string, unknown>)
        ? (
            parsed as {
              error?: { code?: string; message?: string; detail?: unknown };
            }
          ).error
        : null;
    throw new ApiError({
      status: res.status,
      code: errBody?.code ?? `http_${res.status}`,
      message: errBody?.message ?? res.statusText ?? "Request failed",
      detail: errBody?.detail,
    });
  }

  return parsed as T;
}
