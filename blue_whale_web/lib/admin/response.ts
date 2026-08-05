import { NewApiError } from "@blue-whale/core";

/**
 * 管理端统一失败信封（契约第 2 节）：{ success: false, error }。
 * new-api 调用失败时透传其状态码（401/403/502/503 等），其余归 500。
 */
export function adminErrorResponse(error: unknown): Response {
  const status = error instanceof NewApiError ? error.status : 500;
  const safeStatus =
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  const msg = error instanceof Error ? error.message : "未知错误";
  return Response.json({ success: false, error: msg }, { status: safeStatus });
}
