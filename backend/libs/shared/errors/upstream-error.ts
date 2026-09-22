import { NewApiError } from "@lib/core";

/** new-api 上游错误 → 4xx 原样透传、其余 502 兜底（对齐 route handler 的 catch 语义）。 */
export function toUpstreamError(
  error: unknown,
  fallbackMessage: string,
): NewApiError {
  const status =
    error instanceof NewApiError &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 502;
  return new NewApiError(
    error instanceof Error ? error.message : fallbackMessage,
    status,
  );
}
