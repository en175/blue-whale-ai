// IK74V8：从 new-api-client.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 传输层：错误类型、响应信封解析、分页归一化与带超时/追踪头的请求器。
import { generateTraceId, getCurrentTraceId } from "./trace.js";
import type {
  NewApiClientOptions,
  NewApiPageInfo,
} from "./new-api-types.js";

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

/** 归一化 new-api 分页信封（PageInfo），缺字段兜底，防脏数据抛错。 */
export function normalizePage<T>(
  data: unknown,
  pageSize: number,
): NewApiPageInfo<T> {
  const page = (data ?? {}) as Partial<NewApiPageInfo<T>>;
  return {
    items: Array.isArray(page.items) ? page.items : [],
    total: typeof page.total === "number" ? page.total : 0,
    page: typeof page.page === "number" ? page.page : 1,
    page_size: typeof page.page_size === "number" ? page.page_size : pageSize,
  };
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

/**
 * 原生充值接口（/api/user/amount、/api/user/bluewhalepay/pay、
 * /api/user/topup/self）挂在账户层 AccountTokenOrUserAuth 下，只凭 Bearer
 * sk-xxx 证明账户身份；订单 User ID 由 Go 从 Token 属主解析，客户端不得
 * 发送 New-Api-User 头。（RootAuth 的 /api/option/ 管理接口仍需该头，见下方。）
 * 产品代收 POST /internal/v1/topup/pay 不走用户 JWT，只带 X-Blue-Whale-Collect-Token。
 */


/** 单次 new-api 请求：注入鉴权/追踪头，按信封判定业务失败。 */
export type NewApiRequest = <T>(
  path: string,
  init?: RequestInit,
  token?: string,
) => Promise<T>;

/** 带响应元数据的请求：额外返回 X-Oneapi-Request-Id（IK7G9X 用于消费流水精确关联）。 */
export type NewApiRequestWithMeta = <T>(
  path: string,
  init?: RequestInit,
  token?: string,
) => Promise<{ data: T; requestId: string | null }>;

type NewApiRequestResult<T> = {
  payload: T;
  /** X-Oneapi-Request-Id 响应头（new-api 服务端生成，见 middleware/request-id.go）。 */
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
  // 出站统一注入 X-Trace-Id（IK6KQQ/IK73EV）：
  // 调用方显式头 > traceIdProvider（BFF 入站透传）> 链路上下文 > 缺省生成。
  if (!headers.has("X-Trace-Id")) {
    const provided = options.traceIdProvider ? await options.traceIdProvider() : null;
    headers.set(
      "X-Trace-Id",
      provided ?? getCurrentTraceId() ?? generateTraceId(),
    );
  }
  // 出站统一声明客户端系统，网关登录白名单据此识别蓝鲸来源（IKC8XX）：
  // 网关按 X-Client-System 判断请求来源系统，账号 allowed_systems 不含 bluewhale 则拒绝登录。
  // 只拦登录不拦 API 调用；调用方显式头优先，允许将来覆盖为其他系统。
  if (!headers.has("X-Client-System")) {
    headers.set("X-Client-System", "bluewhale");
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
        throw new NewApiError("new-api 不可达", 503);
      }
      payload = null;
    }
  } catch (error) {
    if (error instanceof NewApiError) throw error;
    throw new NewApiError("new-api 不可达", 503);
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", forwardAbort);
  }

  if (payload === null) {
    throw new NewApiError(
      "new-api 响应不是有效 JSON",
      502,
      "invalid_json_response",
    );
  }
  if (!response.ok || isBusinessFailure(payload)) {
    throw new NewApiError(
      messageFrom(payload, `new-api 请求失败: ${response.status}`),
      response.status,
      codeFrom(payload),
      payload,
    );
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
