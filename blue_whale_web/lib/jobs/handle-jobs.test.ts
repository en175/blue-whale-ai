import { describe, expect, it, vi } from "vitest";

import { handleListJobs } from "./handle-list-jobs.js";
import { handleGetJobStatus } from "./handle-get-job-status.js";

// /api/jobs 路由处理器：list（过滤+分页）与 status（单查+错误投影）。
// 对齐 Java GenerationJobService / GenerationPublicError。

function makeDeps() {
  return {
    jobs: {
      listByUser: vi.fn(),
      findByIdForUser: vi.fn(),
    },
    projects: {
      findOwnedById: vi.fn(),
    },
  };
}

const listItem = {
  job_id: "101",
  type: "image",
  status: "succeeded",
  progress: 100,
  input: { prompt: "cat" },
  created_at: "2026-07-27T00:00:00.000Z",
  output_assets: [{ id: "7", url: "https://x/7.png", type: "image", width: 512, height: 512 }],
};

describe("handleListJobs", () => {
  it("按 userId + 过滤条件分页 → 200 + Paged<JobListItem>", async () => {
    const deps = makeDeps();
    deps.jobs.listByUser.mockResolvedValue({
      records: [listItem],
      total: 1,
      size: 20,
      current: 1,
    });
    const result = await handleListJobs("9", { type: "image", page: 1, size: 20 }, deps);
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { records: [listItem], total: 1, size: 20, current: 1 },
    });
    expect(deps.jobs.listByUser).toHaveBeenCalledWith("9", {
      type: "image",
      status: undefined,
      projectId: undefined,
      page: 1,
      size: 20,
    });
  });

  it("空结果 → 200 + 空 records", async () => {
    const deps = makeDeps();
    deps.jobs.listByUser.mockResolvedValue({ records: [], total: 0, size: 20, current: 1 });
    const result = await handleListJobs("9", { page: 1, size: 20 }, deps);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ records: [], total: 0, size: 20, current: 1 });
  });
});

describe("handleGetJobStatus", () => {
  const baseJob = {
    job_id: "101",
    project_id: "55",
    type: "image",
    status: "processing",
    progress: 40,
    asset: null,
    stored_error: null,
  };

  it("存在且归属 → 200 + {job_id,status,progress,asset,error}", async () => {
    const deps = makeDeps();
    deps.jobs.findByIdForUser.mockResolvedValue(baseJob);
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleGetJobStatus("9", "101", deps);
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { job_id: "101", status: "processing", progress: 40, asset: null, error: null },
    });
  });

  it("succeeded + asset → asset 透出", async () => {
    const deps = makeDeps();
    deps.jobs.findByIdForUser.mockResolvedValue({
      ...baseJob,
      status: "succeeded",
      progress: 100,
      asset: { id: "7", url: "https://x/7.png", type: "image" },
    });
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleGetJobStatus("9", "101", deps);
    expect(result.data).toMatchObject({
      status: "succeeded",
      asset: { id: "7", url: "https://x/7.png", type: "image" },
      error: null,
    });
  });

  it("不存在/不归属 → 100301 资源不存在", async () => {
    const deps = makeDeps();
    deps.jobs.findByIdForUser.mockResolvedValue(null);
    const result = await handleGetJobStatus("9", "999", deps);
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
  });

  it("project 不归属 → 100301", async () => {
    const deps = makeDeps();
    deps.jobs.findByIdForUser.mockResolvedValue(baseJob);
    deps.projects.findOwnedById.mockResolvedValue(null);
    const result = await handleGetJobStatus("9", "101", deps);
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
  });

  it("failed + stored_error(provider_failed) → 公开错误信封", async () => {
    const deps = makeDeps();
    deps.jobs.findByIdForUser.mockResolvedValue({
      ...baseJob,
      status: "failed",
      stored_error: { code: "provider_failed", detail: "internal stack" },
    });
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleGetJobStatus("9", "101", deps);
    expect(result.code).toBe(200);
    expect(result.data!.error).toMatchObject({
      code: "provider_failed",
      message: "图像生成失败",
      retryable: false,
      budget_effect: "none",
    });
    // 不透出内部 detail
    expect(result.data!.error).not.toHaveProperty("detail");
  });

  it("failed + 未知 code → fallback image_generation_failed", async () => {
    const deps = makeDeps();
    deps.jobs.findByIdForUser.mockResolvedValue({
      ...baseJob,
      status: "failed",
      stored_error: { code: "weird_internal" },
    });
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleGetJobStatus("9", "101", deps);
    expect(result.data!.error).toMatchObject({
      code: "image_generation_failed",
      message: "图像生成失败",
    });
  });

  it("failed + video 无 code → video_generation_failed / 视频生成失败", async () => {
    const deps = makeDeps();
    deps.jobs.findByIdForUser.mockResolvedValue({
      ...baseJob,
      type: "video",
      status: "failed",
      stored_error: {},
    });
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleGetJobStatus("9", "101", deps);
    expect(result.data!.error).toMatchObject({
      code: "video_generation_failed",
      message: "视频生成失败",
    });
  });

  it("failed + content_rejected → 审核文案", async () => {
    const deps = makeDeps();
    deps.jobs.findByIdForUser.mockResolvedValue({
      ...baseJob,
      status: "failed",
      stored_error: { code: "content_rejected" },
    });
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleGetJobStatus("9", "101", deps);
    expect(result.data!.error).toMatchObject({
      code: "content_rejected",
      message: "生成内容未通过安全审核",
    });
  });
});
