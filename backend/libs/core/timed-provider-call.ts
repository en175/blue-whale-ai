import type { Logger } from "./logger.js";

export interface ProviderCallIdentity {
  provider: string;
  operation: string;
}

export async function timedProviderCall<T>(
  logger: Logger,
  identity: ProviderCallIdentity,
  call: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await call();
    logger.metric({
      event: "provider_call",
      result: "ok",
      duration_ms: Date.now() - startedAt,
      fields: { provider: identity.provider, operation: identity.operation },
    });
    return result;
  } catch (error) {
    logger.metric({
      event: "provider_call",
      result: "fail",
      duration_ms: Date.now() - startedAt,
      fields: { provider: identity.provider, operation: identity.operation },
    });
    throw error;
  }
}
