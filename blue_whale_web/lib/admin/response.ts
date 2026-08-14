import { NewApiError } from "@blue-whale/core";

import { userAuthFailureHeaders } from "@/lib/auth/session-failure";

/**
 * 管理端统一失败信封（契约第 2 节）：{ success: false, error }。
 * new-api 调用失败时透传其状态码（401/403/502/503 等），其余归 500。
 * 401 带用户会话失效标记（IK8N1S）：管理端调用用的就是用户 token。
 */
export function adminErrorResponse(error: unknown): Response {
  const status = error instanceof NewApiError ? error.status : 500;
  const safeStatus =
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  const msg = error instanceof Error ? error.message : "未知错误";
  return Response.json(
    { success: false, error: msg },
    {
      status: safeStatus,
      headers: safeStatus === 401 ? userAuthFailureHeaders() : undefined,
    },
  );
}
