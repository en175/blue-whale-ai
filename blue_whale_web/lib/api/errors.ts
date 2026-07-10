/**
 * errors —— API 错误类型与守卫（IJZYVR API 客户端骨架）
 *
 * 对齐 BACKEND-API-PRD.md §4 错误约定:
 *   { "error": { "code": "...", "message": "...", "detail": {} } }
 *
 * `ApiError` 装载 HTTP status + 后端 code + 人类可读 message + 原始 detail,
 * 消费方可通过 `isApiError(e)` 窄化后按 code 分支处理。
 *
 * P0 已知错误码（PRD §9.4 + §11）:
 *   - quota_exhausted            P2 才接
 *   - content_moderation_rejected
 *   - upstream_timeout
 *   - asset_unavailable
 *   - asset_understanding_missing
 *
 * 此外保留 HTTP 通用 4xx/5xx 兜底 code（"http_<status>"）。
 */

/** P0 业务错误码白名单。消费方 switch 时用穷举,新增需更新。 */
export type ApiErrorCode =
  | "validation_error"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "quota_exhausted"
  | "content_moderation_rejected"
  | "upstream_timeout"
  | "asset_unavailable"
  | "asset_understanding_missing"
  | "internal_error";

export type ApiErrorOptions = {
  status: number;
  code: string;
  message: string;
  detail?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: unknown;

  constructor(opts: ApiErrorOptions) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

/** 类型守卫:消费方拿到 unknown 时窄化到 ApiError。 */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
