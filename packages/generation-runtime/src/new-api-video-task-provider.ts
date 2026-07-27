import { createNewApiClient } from "@blue-whale/core";

import type {
  VideoTaskObservation,
  VideoTaskProvider,
} from "./video-job-runner.js";

const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const FAILED_STATUSES = new Set(["failed", "error", "cancelled", "canceled"]);

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
    submit(input) {
      return client.submitVideo(options.token, {
        ...input,
        responseFormat: "url",
      });
    },

    async poll(taskId): Promise<VideoTaskObservation> {
      const task = await client.getVideoTask(options.token, taskId);
      const status = task.status.toLowerCase();
      if (SUCCESS_STATUSES.has(status)) {
        return {
          status: "succeeded",
          progress: 100,
          url: task.url,
          error: null,
        };
      }
      if (FAILED_STATUSES.has(status)) {
        return {
          status: "failed",
          progress: 100,
          url: null,
          error: {
            code: String(task.error?.code ?? "provider_failed"),
            message: task.error?.message ?? "视频生成失败",
          },
        };
      }
      return {
        status: status === "queued" ? "queued" : "processing",
        progress: 0,
        url: null,
        error: null,
      };
    },
  };
}
