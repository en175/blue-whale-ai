// IK74V8：从 new-api-client.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 传输层：错误类型、响应信封解析、分页归一化与带超时/追踪头的请求器。
import { createLogger, type Logger } from "./logger.js";
import { generateTraceId, getCurrentTraceId } from "./trace.js";
import type {
  NewApiClientOptions,
  NewApiPageInfo,
} from "./new-api-types.js";

/** new-api 出站失败日志（IKDZGM）：失败可定位——status/request_id/原始 body/堆栈一次带全。
 *  传输层是所有出站调用的汇聚点，此处打日志覆盖视频/音频/图片/素材库/计费/账号所有调用方。 */
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

/** 出站失败日志（IKDZGM）：任何 new-api 调用失败都打一行结构化日志，供排查定位。
 *  封装在同一处，失败分支统一调用。path 是调用方传入的相对路径（不记录 baseUrl，避免泄漏内部地址）。 */
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
  // body 只放报错原文；detail（原始响应体）与 message 相同时不重复，仅在有差异时附加。
  // 长度与脱敏交由 logger.error 内部的 redactLogBody 统一兜底（MAX_BODY_CHARS=4096）。
  const detailText =
    error.detail != null ? JSON.stringify(error.detail) : "";
  const body =
    detailText && detailText !== error.message
      ? `${error.message} | resp: ${detailText}`
      : error.message;
  newApiLogger.error(body, extras);
}

/** 超时错误（IKDQ5F）：出站请求在 timeoutMs 内未返回，AbortController 主动中止。
 *  继承 NewApiError（503，语义对齐旧「new-api 不可达」），现有 `instanceof NewApiError`
 *  分支全部兼容；需要区分超时语义的调用方（如音频 provider 归 provider_timeout）判
 *  `instanceof NewApiTimeoutError`。 */
export class NewApiTimeoutError extends NewApiError {
  constructor(message = "new-api 不可达") {
    super(message, 503, "timeout");
    this.name = "NewApiTimeoutError";
  }
}

/** 网络不可达错误（IKEA26）：fetch 无响应（连接层异常——undici `fetch failed`、
 *  ECONNRESET/ECONNREFUSED/ETIMEDOUT 等），非 new-api 返回的业务错误。
 *  继承 NewApiError（503，语义对齐旧「new-api 不可达」），现有 `instanceof NewApiError`
 *  分支全部兼容；需要区分「瞬时网络抖动」与「上游 HTTP 业务失败」的调用方（如视频 runner
 *  轮询把瞬时错误重排而非判死）判 `instanceof NewApiNetworkError`。cause 链原始异常供排查。 */
export class NewApiNetworkError extends NewApiError {
  constructor(message = "new-api 不可达", cause?: unknown) {
    super(message, 503, "unreachable");
    this.name = "NewApiNetworkError";
    // 原生 Error cause 链原始异常（undici TypeError / ECONNRESET 等）供排查；
    // 不塞 detail——避免 logNewApiFailure 对原始错误 JSON.stringify 污染失败日志。
    if (cause !== undefined) this.cause = cause;
  }
}

/** 出站客户端系统标识（网关登录白名单据此识别蓝鲸来源，见 ADR-0080）。 */
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
  // 出站统一声明客户端系统（ADR-0080）：网关登录白名单按 X-Client-System 判断来源系统，
  // 账号 allowed_systems 不含 bluewhale 则拒绝登录。只拦登录不拦 API 调用；调用方显式头优先。
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
        // IKDQ5F：超时中止（AbortController 主动 abort）→ 可区分超时语义的 NewApiTimeoutError，
        // 不再与「响应非 JSON」混为一个 502 裸 NewApiError。同时为「请求已发出但未收到有效响应」
        // 保留可定位性：status=503/request_id 缺省，堆栈已在 NewApiTimeoutError 携带。
        const failed = new NewApiTimeoutError();
        logNewApiFailure(failed, path, null);
        throw failed;
      }
      payload = null;
    }
  } catch (error) {
    if (error instanceof NewApiError) throw error;
    // IKDQ5F：fetch 层主动 abort（AbortSignal.timeout / controller.abort）同样归超时，
    // 供调用方区分 provider_timeout；其余网络异常（undici fetch failed / ECONNRESET /
    // ECONNREFUSED / ETIMEDOUT）归网络不可达（IKEA26：调用方可判 instance 做瞬时重排）。
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

/** 原始响应（IKDQ5F）：保留 status + 正文 + 响应头，不做信封解析。
 *  用于非信封接口（如音频 `/v1/audio/speech` 官方透传 JSON / 纯 text 错误体）——
 *  performRequest 的强制 `response.json()` 会吞掉非 JSON 错误原文与状态码。 */
export interface NewApiRawResult {
  status: number;
  text: string;
  headers: Headers;
  /** X-Oneapi-Request-Id 响应头（new-api 服务端生成，IK7G9X 消费流水精确关联）。 */
  requestId: string | null;
}

export type NewApiRawRequest = (
  path: string,
  init?: RequestInit,
  token?: string,
) => Promise<NewApiRawResult>;

/** 带超时/追踪头/出站系统头的原始响应请求器（复用 performRequest 的头注入逻辑）。
 *  不抛业务失败（isBusinessFailure/!ok 不上抛——音频 provider 需要原始 status + 原文做
 *  content-policy > quota > provider_failed 分类判定）；超时仍抛 NewApiTimeoutError。 */
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
      // raw 路径同样给失败留痕（音频/视频 raw 调用用）——失败要知道为啥失败（IKDZGM）。
      if (controller.signal.aborted) {
        const failed = new NewApiTimeoutError();
        logNewApiFailure(failed, path, null);
        throw failed;
      }
      // IKEA26：raw 路径（音频 provider 用）的网络异常同样归 NewApiNetworkError，
      // 与信封路径判定一致；cause 链原始异常。
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
