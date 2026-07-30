import { describe, expect, it, vi } from "vitest";

import { handleRetryGenerationJob } from "./handle-retry-generation-job.js";

// 重试命令处理器：仅终态 failed/partially_succeeded 的 job 可重试（retryJob 内置校验）。
// 对齐 cancel 处理器结构；返回新 job id + type，路由按 type 重新入队。

function makeDeps() {
  return {
    projects: { findOwnedById: vi.fn() },
    command: { retryJob: vi.fn() },
  };
}

describe("handleRetryGenerationJob", () => {
  it("归属 + 可重试 → 200 + 新 job（带 type 供路由按类型入队）", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.retryJob.mockResolvedValue({
      generation_job_id: "300",
      cursor: 0,
      type: "video",
    });
    const result = await handleRetryGenerationJob("9", "55", "200", "key-1", deps);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({
      generation_job_id: "300",
      cursor: 0,
      type: "video",
    });
    expect(deps.command.retryJob).toHaveBeenCalledWith("200", "9", "key-1");
  });

  it("project 不归属 → 100301，不调 retryJob", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue(null);
    const result = await handleRetryGenerationJob("9", "55", "200", "k", deps);
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
    expect(deps.command.retryJob).not.toHaveBeenCalled();
  });

  it("原 job 非终态失败（retryJob 返回 null）→ 100301（强制「真失败才重试」）", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.retryJob.mockResolvedValue(null);
    const result = await handleRetryGenerationJob("9", "55", "200", "k", deps);
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
  });
});
