/**
 * provider 调用计时打点（IK7G9Y）。
 *
 * 成功/失败都发 provider_call metric（带 duration_ms），失败原样抛出。
 * 当前用于视频 provider（new_api_video 的 submit/poll）；metric 通道自身永不抛错（logger 约束）。
 */
import type { Logger } from "./logger.js";

export interface ProviderCallIdentity {
  /** provider 名，如 new_api_video */
  provider: string;
  /** 操作名，如 submit / poll / invoke */
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
