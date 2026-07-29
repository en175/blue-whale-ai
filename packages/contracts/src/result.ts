/** 对齐 Java blue-whale-global Result<T>：{ code, msg, data }，msg 默认 null（不是 "success"）。
 *  前端 apiRequest 只看 code !== 200 抛错。 */
export const SUCCESS_CODE = 200;
export const FAILURE_CODE = 400;
export const DATA_NOT_EXIST_CODE = 100100; // 对齐 Java SystemCode.DATA_NOT_EXIST_CODE
export const ASSET_UNAVAILABLE_CODE = 100202; // 对齐 Java SystemCode.ASSET_UNAVAILABLE_CODE
export const RESOURCE_NOT_FOUND_CODE = 100301; // 对齐 Java SystemCode.RESOURCE_NOT_FOUND_CODE（不泄漏存在性）
export const IDEMPOTENCY_KEY_REUSED_CODE = 100302; // 对齐 Java SystemCode.IDEMPOTENCY_KEY_REUSED_CODE
export const PARAM_MISSING_CODE = 100000; // 对齐 Java GlobalException(100000, "缺少 Idempotency-Key")

export interface ResultEnvelope<T> {
  code: number;
  msg: string | null;
  data: T | null;
}

export function ok(): ResultEnvelope<null>;
export function ok<T>(data: T, msg?: string | null): ResultEnvelope<T>;
export function ok<T>(data?: T, msg?: string | null): ResultEnvelope<T | null> {
  return { code: SUCCESS_CODE, data: data ?? null, msg: msg ?? null };
}

export function fail(code: number, msg: string | null, data?: unknown): ResultEnvelope<never>;
export function fail(code: number, msg: string | null, data?: unknown): ResultEnvelope<unknown>;
export function fail(code: number, msg: string | null, data?: unknown): ResultEnvelope<unknown> {
  return { code, msg, data: data ?? null };
}
