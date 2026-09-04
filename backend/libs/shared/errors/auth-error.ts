import { NewApiError } from "@blue-whale/core";

/** new-api 账户服务鉴权错误 → 401/403/502/503 统一映射（对齐 lib/account/bff 语义）。 */
const AUTH_MESSAGES = new Map<number, string>([
  [401, "登录凭证无效"],
  [403, "账户已停用"],
  [502, "账户服务响应异常"],
  [503, "账户服务暂不可用"],
]);

const FALLBACK_MESSAGE = "账户服务响应异常";

export function toAuthError(error: unknown): NewApiError {
  if (error instanceof NewApiError) {
    const message = AUTH_MESSAGES.get(error.status);
    if (message) {
      return new NewApiError(message, error.status, error.code);
    }
  }
  return new NewApiError(FALLBACK_MESSAGE, 502, "account_service_error");
}

/** 上游 HTTP 200 + success:false 业务失败 → 透传原文到指定 HTTP 状态（login 401 / register 400）。
 *  避免 toAuthError 的 status 映射吞掉业务文案（如登录隔离白名单拒绝）；不适用时返回 null。 */
export function projectAccountBusinessFailure(
  error: unknown,
  status: number,
): NewApiError | null {
  if (error instanceof NewApiError && error.status === 200) {
    return new NewApiError(error.message, status, error.code);
  }
  return null;
}
