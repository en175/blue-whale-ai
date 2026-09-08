/** 对齐 Java blue-whale-global Result<T>：{ code, msg, data }，msg 默认 null（不是 "success"）。
 *  前端 apiRequest 只看 code !== 200 抛错。
 *  错误码段位约定与全部业务错误码见 error-codes.ts（IKDZGM / ADR-0083 高内聚唯一来源）：
 *  - 4xx / 5xx：HTTP 语义错误（参数/未授权/资源不存在等基础设施错误）；
 *  - 1xxxx（100000+）：Java SystemCode 系全局业务码（DATA_NOT_EXIST / PLAN_APPLICATION_* 等）；
 *  - 1xxx（1000-1999）：领域错误码——生成任务领域已用 1001-1028（quota_exhausted=1001）。
 *  本文件只负责信封 + HTTP 汇总码；业务错误码全部定义在 error-codes.ts。 */
import { FAILURE_CODE, SUCCESS_CODE } from "./error-codes.js";

export { FAILURE_CODE, SUCCESS_CODE };

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
