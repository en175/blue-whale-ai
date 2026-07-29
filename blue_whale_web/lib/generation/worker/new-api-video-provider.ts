import { NewApiError, createNewApiClient } from "@blue-whale/core";

import {
  VideoProviderError,
  type GenerateVideoInput,
  type VideoProvider,
} from "./video-provider";

type VideoProviderOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
};

const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const FAILED_STATUSES = new Set(["failed", "failure", "error", "cancelled", "canceled"]);

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function providerError(error: unknown): VideoProviderError {
  if (error instanceof VideoProviderError) return error;
  if (error instanceof NewApiError) {
    return new VideoProviderError(
      error.status === 402 ? "quota_exhausted" : "provider_failed",
      error.message,
    );
  }
  return new VideoProviderError(
    "provider_failed",
    error instanceof Error ? error.message : "视频生成失败",
  );
}

export function createNewApiVideoProvider(
  options: VideoProviderOptions,
): VideoProvider {
  const client = createNewApiClient({
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
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
          const task = await client.getVideoTask(options.token, submitted.taskId);
          const status = task.status.toLowerCase();
          if (SUCCESS_STATUSES.has(status)) {
            if (!task.url) {
              throw new VideoProviderError(
                "provider_failed",
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
            throw new VideoProviderError(
              "provider_failed",
              task.error?.message ?? "视频生成失败",
            );
          }
          if (attempt < maxPollAttempts - 1) {
            await sleep(pollIntervalMs);
          }
        }

        throw new VideoProviderError(
          "provider_timeout",
          "视频生成轮询超时",
        );
      } catch (error) {
        throw providerError(error);
      }
    },
  };
}

export { VideoProviderError } from "./video-provider";
