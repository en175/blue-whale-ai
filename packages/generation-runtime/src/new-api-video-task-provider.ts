import { createNewApiClient } from "@blue-whale/core";
import { ERROR_PROVIDER_FAILED } from "@blue-whale/contracts";

import type {
  VideoTaskObservation,
  VideoTaskProvider,
} from "./video-job-runner.js";

const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const FAILED_STATUSES = new Set(["failed", "failure", "error", "cancelled", "canceled"]);

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
        return {
          status: "failed",
          progress: 100,
          url: null,
          ...(quota !== undefined ? { quota } : {}),
          error: {
            code: String(task.error?.code ?? ERROR_PROVIDER_FAILED),
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
