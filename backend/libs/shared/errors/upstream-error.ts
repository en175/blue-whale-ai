import { NewApiError } from "@lib/core";

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
