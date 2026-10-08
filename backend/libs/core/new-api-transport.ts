import { createLogger, type Logger } from "./logger.js";
import { generateTraceId, getCurrentTraceId } from "./trace.js";
import type { NewApiClientOptions } from "./new-api-types.js";

const newApiLogger: Logger = createLogger("new-api");

export class NewApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string | number,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "NewApiError";
  }
}

function logNewApiFailure(
  error: NewApiError,
  path: string,
  requestId: string | null,
): void {
  const extras: Record<string, string | number> = {
    status: error.status,
    ...(requestId ? { request_id: requestId } : {}),
    ...(error.code !== undefined ? { err_code: String(error.code) } : {}),
    url: path,
  };
  const detailText =
    error.detail != null ? JSON.stringify(error.detail) : "";
  const body =
    detailText && detailText !== error.message
      ? `${error.message} | resp: ${detailText}`
      : error.message;
  newApiLogger.error(body, extras);
}

export class NewApiTimeoutError extends NewApiError {
  constructor(message = "new-api 不可达") {
    super(message, 503, "timeout");
    this.name = "NewApiTimeoutError";
  }
}

export class NewApiNetworkError extends NewApiError {
  constructor(message = "new-api 不可达", cause?: unknown) {
    super(message, 503, "unreachable");
    this.name = "NewApiNetworkError";
    if (cause !== undefined) this.cause = cause;
  }
}

export const CLIENT_SYSTEM_BLUEWHALE = "bluewhale";

export type NewApiEnvelope = {
  success?: boolean;
  code?: boolean | number | string;
  message?: string;
  msg?: string;
  error?: {
    code?: boolean | number | string;
    message?: string;
  };
  data?: unknown;
};

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function messageFrom(payload: NewApiEnvelope | null, fallback: string): string {
  return typeof payload?.message === "string"
    ? payload.message
    : typeof payload?.msg === "string"
      ? payload.msg
      : typeof payload?.error?.message === "string"
        ? payload.error.message
      : fallback;
}

export function codeFrom(payload: NewApiEnvelope | null): string | number | undefined {
  if (typeof payload?.code === "string" || typeof payload?.code === "number") {
    return payload.code;
  }
  return typeof payload?.error?.code === "string" || typeof payload?.error?.code === "number"
    ? payload.error.code
    : undefined;
}

export function isBusinessFailure(payload: NewApiEnvelope | null): boolean {
  return payload?.success === false || payload?.code === false;
}

export function positiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}



export type NewApiRequest = <T>(
  path: string,
  init?: RequestInit,
  token?: string,
) => Promise<T>;

export type NewApiRequestWithMeta = <T>(
  path: string,
  init?: RequestInit,
  token?: string,
) => Promise<{ data: T; requestId: string | null }>;

type NewApiRequestResult<T> = {
  payload: T;
  requestId: string | null;
};

async function performRequest<T>(
  options: NewApiClientOptions,
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<NewApiRequestResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("X-Trace-Id")) {
    const provided = options.traceIdProvider ? await options.traceIdProvider() : null;
    headers.set(
      "X-Trace-Id",
      provided ?? getCurrentTraceId() ?? generateTraceId(),
    );
  }
  if (!headers.has("X-Client-System")) {
    headers.set("X-Client-System", CLIENT_SYSTEM_BLUEWHALE);
  }

  let response: Response;
  let payload: NewApiEnvelope | null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  if (init.signal?.aborted) {
    controller.abort();
  } else {
    init.signal?.addEventListener("abort", forwardAbort, { once: true });
  }
  try {
    response = await fetchImpl(joinUrl(options.baseUrl, path), {
      ...init,
      headers,
      signal: controller.signal,
    });
    try {
      payload = (await response.json()) as NewApiEnvelope;
    } catch {
      if (controller.signal.aborted) {
        const failed = new NewApiTimeoutError();
        logNewApiFailure(failed, path, null);
        throw failed;
      }
      payload = null;
    }
  } catch (error) {
    if (error instanceof NewApiError) throw error;
    if (controller.signal.aborted) {
      const failed = new NewApiTimeoutError();
      logNewApiFailure(failed, path, null);
      throw failed;
    }
    const failed = new NewApiNetworkError("new-api 不可达", error);
    logNewApiFailure(failed, path, null);
    throw failed;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", forwardAbort);
  }

  if (payload === null) {
    const parsedRequestId = response.headers.get("X-Oneapi-Request-Id");
    const failed = new NewApiError(
      "new-api 响应不是有效 JSON",
      502,
      "invalid_json_response",
    );
    logNewApiFailure(failed, path, parsedRequestId);
    throw failed;
  }
  if (!response.ok || isBusinessFailure(payload)) {
    const requestId = response.headers.get("X-Oneapi-Request-Id");
    const failed = new NewApiError(
      messageFrom(payload, `new-api 请求失败: ${response.status}`),
      response.status,
      codeFrom(payload),
      payload,
    );
    logNewApiFailure(failed, path, requestId);
    throw failed;
  }
  return {
    payload: payload as T,
    requestId: response.headers.get("X-Oneapi-Request-Id"),
  };
}

export function createNewApiRequest(
  options: NewApiClientOptions,
): NewApiRequest {
  return async function request<T>(
    path: string,
    init?: RequestInit,
    token?: string,
  ): Promise<T> {
    return (await performRequest<T>(options, path, init, token)).payload;
  };
}

export function createNewApiRequestWithMeta(
  options: NewApiClientOptions,
): NewApiRequestWithMeta {
  return async function requestWithMeta<T>(
    path: string,
    init?: RequestInit,
    token?: string,
  ): Promise<{ data: T; requestId: string | null }> {
    const result = await performRequest<T>(options, path, init, token);
    return { data: result.payload, requestId: result.requestId };
  };
}

export interface NewApiRawResult {
  status: number;
  text: string;
  headers: Headers;
  requestId: string | null;
}

export type NewApiRawRequest = (
  path: string,
  init?: RequestInit,
  token?: string,
) => Promise<NewApiRawResult>;

export function createNewApiRawRequest(
  options: NewApiClientOptions,
): NewApiRawRequest {
  return async function rawRequest(
    path: string,
    init: RequestInit = {},
    token?: string,
  ): Promise<NewApiRawResult> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("X-Trace-Id")) {
      const provided = options.traceIdProvider
        ? await options.traceIdProvider()
        : null;
      headers.set(
        "X-Trace-Id",
        provided ?? getCurrentTraceId() ?? generateTraceId(),
      );
    }
    if (!headers.has("X-Client-System")) {
      headers.set("X-Client-System", CLIENT_SYSTEM_BLUEWHALE);
    }

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort();
    if (init.signal?.aborted) {
      controller.abort();
    } else {
      init.signal?.addEventListener("abort", forwardAbort, { once: true });
    }
    try {
      response = await fetchImpl(joinUrl(options.baseUrl, path), {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof NewApiError) throw error;
      if (controller.signal.aborted) {
        const failed = new NewApiTimeoutError();
        logNewApiFailure(failed, path, null);
        throw failed;
      }
      const failed = new NewApiNetworkError("new-api 不可达", error);
      logNewApiFailure(failed, path, null);
      throw failed;
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", forwardAbort);
    }

    const text = await response.text().catch(() => "");
    return {
      status: response.status,
      text,
      headers: response.headers,
      requestId: response.headers.get("X-Oneapi-Request-Id"),
    };
  };
}
