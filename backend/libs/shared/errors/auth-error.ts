import { NewApiError } from "@lib/core";

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

export function projectAccountBusinessFailure(
  error: unknown,
  status: number,
): NewApiError | null {
  if (error instanceof NewApiError && error.status === 200) {
    return new NewApiError(error.message, status, error.code);
  }
  return null;
}
