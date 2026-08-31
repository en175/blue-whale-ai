import { NewApiError } from "@blue-whale/core";
import { createNewApiClient } from "@blue-whale/core";
import {
  ERROR_PROVIDER_FAILED,
  ERROR_PROVIDER_TIMEOUT,
  ERROR_QUOTA_EXHAUSTED,
} from "@blue-whale/contracts";

import {
  VideoProviderError,
  type GenerateVideoInput,
  type VideoProvider,
} from "./video-provider.js";

type VideoProviderOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
};

const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const FAILED_STATUSES = new Set([
  "failed",
  "failure",
  "error",
  "cancelled",
  "canceled",
]);

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function providerError(error: unknown): VideoProviderError {
  if (error instanceof VideoProviderError) return error;
  if (error instanceof NewApiError) {
    // IKBQEE：余额不足识别——不只看 402，也认 new-api 中文「预扣费额度失败/用户剩余额度」
    // 与英文 quota/balance/insufficient（job 1565「预扣费额度失败」为 HTTP200+body 报错，非 402）。
    const msg = String(error.message);
    const isQuotaSignal =
      error.status === 402 ||
      /(预扣费|剩余额度|余额|额度不足|quota|balance|insufficient|payment_required)/i.test(
        msg,
      );
    return new VideoProviderError(
      isQuotaSignal ? ERROR_QUOTA_EXHAUSTED : ERROR_PROVIDER_FAILED,
      error.message,
    );
  }
  return new VideoProviderError(
    ERROR_PROVIDER_FAILED,
    error instanceof Error ? error.message : "视频生成失败",
  );
}

export function createNewApiVideoProvider(
  options: VideoProviderOptions,
): VideoProvider {
  const client = createNewApiClient({
    baseUrl: options.baseUrl,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const maxPollAttempts = options.maxPollAttempts ?? 90;

  return {
    async generate(input: GenerateVideoInput) {
      try {
        const submitted = await client.submitVideo(options.token, {
          ...input,
          responseFormat: "url",
        });

        for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
          const task = await client.getVideoTask(
            options.token,
            submitted.taskId,
          );
          const status = task.status.toLowerCase();
          if (SUCCESS_STATUSES.has(status)) {
            if (!task.url) {
              throw new VideoProviderError(
                ERROR_PROVIDER_FAILED,
                "视频任务成功但未返回 URL",
              );
            }
            return {
              url: task.url,
              width: input.width,
              height: input.height,
            };
          }
          if (FAILED_STATUSES.has(status)) {
            // IKBQEE：任务失败态同样识别余额不足 → quota_exhausted
            const msg = String(task.error?.message ?? "");
            const isQuotaSignal =
              /(预扣费|剩余额度|余额|额度不足|quota|balance|insufficient|payment_required)/i.test(
                msg,
              );
            throw new VideoProviderError(
              isQuotaSignal ? ERROR_QUOTA_EXHAUSTED : ERROR_PROVIDER_FAILED,
              task.error?.message ?? "视频生成失败",
            );
          }
          if (attempt < maxPollAttempts - 1) {
            await sleep(pollIntervalMs);
          }
        }

        throw new VideoProviderError(ERROR_PROVIDER_TIMEOUT, "视频生成轮询超时");
      } catch (error) {
        throw providerError(error);
      }
    },
  };
}

export { VideoProviderError } from "./video-provider.js";
