import { FAILURE_CODE, SUCCESS_CODE } from "./error-codes.js";

export { FAILURE_CODE, SUCCESS_CODE };

export interface ResultEnvelope<T> {
  code: number;
  msg: string | null;
  data: T | null;
  error_code?: string;
}

export function ok(): ResultEnvelope<null>;
export function ok<T>(data: T, msg?: string | null): ResultEnvelope<T>;
export function ok<T>(data?: T, msg?: string | null): ResultEnvelope<T | null> {
  return { code: SUCCESS_CODE, data: data ?? null, msg: msg ?? null };
}

export function fail(
  code: number,
  msg: string | null,
  data?: unknown,
  errorCode?: string,
): ResultEnvelope<never>;
export function fail(
  code: number,
  msg: string | null,
  data?: unknown,
  errorCode?: string,
): ResultEnvelope<unknown>;
export function fail(
  code: number,
  msg: string | null,
  data?: unknown,
  errorCode?: string,
): ResultEnvelope<unknown> {
  return {
    code,
    msg,
    data: data ?? null,
    ...(errorCode ? { error_code: errorCode } : {}),
  };
}
