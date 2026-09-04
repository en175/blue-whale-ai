import { NewApiError, createNewApiClient } from "@blue-whale/core";
import {
  ERROR_CONTENT_REJECTED,
  ERROR_PROVIDER_FAILED,
  ERROR_QUOTA_EXHAUSTED,
  isContentPolicySignal,
  isQuotaSignal,
} from "@blue-whale/contracts";

import {
  VideoProviderError,
  type VideoTaskObservation,
  type VideoTaskProvider,
} from "./video-job-runner.js";

const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const FAILED_STATUSES = new Set(["failed", "failure", "error", "cancelled", "canceled"]);

/** NewApiError → VideoProviderError：submit 阶段识别欠费语义（IKBQEE）。
 *  欠费判定 = HTTP 402 或 业务 code/message 命中欠费信号（共享 isQuotaSignal）。
 *  IKDAJN：版权/敏感（copyright/sensitive）优先于欠费判定，归 content_rejected。 */
function toVideoProviderError(error: unknown): VideoProviderError {
  if (error instanceof VideoProviderError) return error;
  if (error instanceof NewApiError) {
    const text = `${error.code ?? ""} ${error.message}`;
    const code = isContentPolicySignal(text)
      ? ERROR_CONTENT_REJECTED
      : isQuotaSignal(text, error.status)
        ? ERROR_QUOTA_EXHAUSTED
        : ERROR_PROVIDER_FAILED;
    return new VideoProviderError(code, error.message);
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

  return {
    // IKBQEE / ADR-0078：submit 阶段同样识别欠费——new-api 预扣费失败（HTTP200+body 或 402）
    // 由 transport 抛 NewApiError，这里归一为 quota_exhausted，避免被 runner catch 归成 provider_failed
    // （job 1612 真实案例：余额不足却显示「视频生成失败」）。
    async submit(input) {
      try {
        return await client.submitVideo(options.token, {
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
        // IKDAJN：版权/敏感（copyright/sensitive）优先于 quota 判定 → content_rejected，
        // 不再把上游 content-policy 码原样透传（投影时会被白名单 fallback 吞语义）。
        const upstreamCode = task.error?.code;
        const upstreamText = `${upstreamCode ?? ""} ${task.error?.message ?? ""}`;
        const code = isContentPolicySignal(upstreamText)
          ? ERROR_CONTENT_REJECTED
          : isQuotaSignal(upstreamText)
            ? ERROR_QUOTA_EXHAUSTED
            : String(upstreamCode ?? ERROR_PROVIDER_FAILED);
        return {
          status: "failed",
          progress: 100,
          url: null,
          ...(quota !== undefined ? { quota } : {}),
          error: {
            code,
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
