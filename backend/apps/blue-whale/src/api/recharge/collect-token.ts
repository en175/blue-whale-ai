import { logger } from "@lib/infra/logging/blue-whale-logger.js";

export const COLLECT_TOKEN_ENV = "BLUE_WHALE_TOPUP_COLLECT_TOKEN";

const MISSING_TOKEN_LOG = "BLUE_WHALE_TOPUP_COLLECT_TOKEN 未配置，可能无法下单";

type Env = Record<string, string | undefined>;

export function readCollectToken(env: Env = process.env): string | null {
  const value = env[COLLECT_TOKEN_ENV]?.trim();
  return value ? value : null;
}

export function warnIfCollectTokenMissing(
  log: { warn: (message: string) => void } = logger,
  env: Env = process.env,
): void {
  if (!readCollectToken(env)) {
    log.warn(MISSING_TOKEN_LOG);
  }
}
