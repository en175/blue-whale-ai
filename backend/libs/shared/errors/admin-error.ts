import { NewApiError } from "@lib/core";

export class AdminException extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminException";
  }
}

export function toAdminError(error: unknown): AdminException {
  const status = error instanceof NewApiError ? error.status : 500;
  const safeStatus =
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  const msg = error instanceof Error ? error.message : "未知错误";
  return new AdminException(safeStatus, msg);
}
