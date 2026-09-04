import { NewApiError, createNewApiClient } from "@blue-whale/core";
import {
  ERROR_PROVIDER_FAILED,
  ERROR_QUOTA_EXHAUSTED,
} from "@blue-whale/contracts";

import {
  VideoProviderError,
  type VideoTaskObservation,
  type VideoTaskProvider,
} from "./video-job-runner.js";

const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const FAILED_STATUSES = new Set(["failed", "failure", "error", "cancelled", "canceled"]);

/**
 * new-api 欠费信号（IKBQEE / ADR-0078 共享判定）。
 * 不只看 402：new-api 预扣费失败常以 HTTP200+body 报错（job 1565/1612 真实案例），
 * 中文「预扣费额度失败/剩余额度/余额」与英文 quota/balance/insufficient 均命中。
 * submit 与 poll 两阶段共用，避免漏判。
 */
export const NEW_API_QUOTA_SIGNAL =
  /(预扣费|剩余额度|余额|额度不足|quota|balance|insufficient|payment_required|(^|\D)402(\D|$))/i;

function isQuotaSignal(text: string): boolean {
  return NEW_API_QUOTA_SIGNAL.test(text);
}

/** NewApiError → VideoProviderError：submit 阶段识别欠费语义（IKBQEE）。
 *  欠费判定 = HTTP 402 或 业务 code/message 命中欠费信号（正则里含数字 402 以覆盖
 *  business code 字段为 402 的形态，与 audio provider / 旧 backend providerError 对齐）。 */
function toVideoProviderError(error: unknown): VideoProviderError {
  if (error instanceof VideoProviderError) return error;
  if (error instanceof NewApiError) {
    const isQuota =
      error.status === 402 ||
      isQuotaSignal(`${error.code ?? ""} ${error.message}`);
    return new VideoProviderError(
      isQuota ? ERROR_QUOTA_EXHAUSTED : ERROR_PROVIDER_FAILED,
      error.message,
    );
  }
  return new VideoProviderError(
    ERROR_PROVIDER_FAILED,
    error instanceof Error ? error.message : "视频生成失败",
  );
}

export function createNewApiVideoTaskProvider(options: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): VideoTaskProvider {
  const client = createNewApiClient({
    baseUrl: options.baseUrl,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  // 视频 submit 上游可能慢（火山高峰 12–15s 返回 200），worker 侧默认 10s 硬超时
  // 会提前 abort 误报失败；仅 submit 提为 30s，poll 保持默认 10s。
  const submitClient = createNewApiClient({
    baseUrl: options.baseUrl,
    timeoutMs: 30_000,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  return {
    // IKBQEE / ADR-0078：submit 阶段同样识别欠费——new-api 预扣费失败（HTTP200+body 或 402）
    // 由 transport 抛 NewApiError，这里归一为 quota_exhausted，避免被 runner catch 归成 provider_failed
    // （job 1612 真实案例：余额不足却显示「视频生成失败」）。
    async submit(input) {
      try {
        return await submitClient.submitVideo(options.token, {
          ...input,
          responseFormat: "url",
        });
      } catch (error) {
        throw toVideoProviderError(error);
      }
    },

    async poll(taskId): Promise<VideoTaskObservation> {
      const task = await client.getVideoTask(options.token, taskId);
      const status = task.status.toLowerCase();
      // IK7G9X：透出 new-api 任务 quota（成功结算后即实际扣费额）。
      const quota = task.quota;
      if (SUCCESS_STATUSES.has(status)) {
        return {
          status: "succeeded",
          progress: 100,
          url: task.url,
          ...(quota !== undefined ? { quota } : {}),
          error: null,
        };
      }
      if (FAILED_STATUSES.has(status)) {
        // IKBQEE / ADR-0078：quota 语义还原——上游错误带 402/欠费信号时映射 quota_exhausted，
        // 避免欠费语义被 provider_failed 吞掉（job 1494 真实案例）。
        const upstreamCode = task.error?.code;
        const isQuota =
          isQuotaSignal(`${upstreamCode ?? ""} ${task.error?.message ?? ""}`);
        return {
          status: "failed",
          progress: 100,
          url: null,
          ...(quota !== undefined ? { quota } : {}),
          error: {
            code: isQuota
              ? ERROR_QUOTA_EXHAUSTED
              : String(upstreamCode ?? ERROR_PROVIDER_FAILED),
            message: task.error?.message ?? "视频生成失败",
          },
        };
      }
      return {
        status: status === "queued" ? "queued" : "processing",
        progress: 0,
        url: null,
        ...(quota !== undefined ? { quota } : {}),
        error: null,
      };
    },
  };
}
