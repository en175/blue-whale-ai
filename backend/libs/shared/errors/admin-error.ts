import { NewApiError } from "@lib/core";

/** 管理端失败异常：过滤器映射为 { success: false, error }（契约第 2 节）。 */
export class AdminException extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminException";
  }
}

/** new-api/未知错误 → AdminException；new-api 状态码 400–599 透传，其余 500。 */
export function toAdminError(error: unknown): AdminException {
  const status = error instanceof NewApiError ? error.status : 500;
  const safeStatus =
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  const msg = error instanceof Error ? error.message : "未知错误";
  return new AdminException(safeStatus, msg);
}
