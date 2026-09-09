import {
  ASSET_ERROR_SPECS,
  httpStatusForCode,
  messageOf,
  type AssetErrorName,
  type ErrorCodeSpec,
} from "./error-codes.js";

/**
 * 带**数值领域码**的业务错误。抛它，别 `return fail(...)`。
 *
 * ADR-0083 把根因写死了一句：本仓有**两套投影机制**——`throw` 出去的经
 * `AllExceptionsFilter`（那里写了 HTTP 状态码），`return fail(code, msg)` 被
 * `TransformInterceptor` 原样透传（状态码由 Nest 按方法默认给）。于是同一个「拒绝」，
 * 走前一条路回 400，走后一条路回 **201**。
 *
 * 实测过的后果（2026-09-08 测试站）：`POST /api/agent/assets/uploads/presign` 传一份 SVG，
 * 回的是 `HTTP 201` + body `{"code":400,"msg":"这个图片格式读不了…"}`。本仓前端两条都判所以
 * 没出事，但那是前端替后端兜的——任何只看状态码的客户端都会把这次拒绝当成上传成功。
 *
 * 所以失败要么是异常，要么就不叫失败：**`AllExceptionsFilter` 是唯一投影出入口**，
 * 只要从这里出去，`code`、`msg`、HTTP 状态三者必然一致，因为它们同出一张码表。
 */
export class DomainError extends Error {
  /** 对外数值码，落在码表的段位里（素材域 2xxx，全局业务码 1xxxx…）。 */
  readonly code: number;
  /** 这次要回的 HTTP 状态码。由码表给，不由调用点临时决定。 */
  readonly status: number;

  /**
   * `message` 默认取码表里那条文案。**调用点不要自己写中文**——写了就等于在码表之外
   * 又开了一份文案，两份迟早分叉（ADR-0083 §3「文案唯一生成」）。
   * 留这个参数只为一种情况：文案里要嵌本次请求才知道的值。
   */
  constructor(code: number, message?: string, status?: number) {
    super(message ?? messageOf(code));
    this.name = "DomainError";
    this.code = code;
    this.status = status ?? httpStatusForCode(code);
  }
}

/** 从码表里那一行直接造错误——码、状态、文案一次对齐，调用点只写名字。 */
export function assetError(name: AssetErrorName): DomainError {
  const spec: ErrorCodeSpec = ASSET_ERROR_SPECS[name];
  return new DomainError(spec.code, spec.message, spec.status);
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
