import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api-client";
import {
  cancelProjectGenerationJob,
  createProjectGenerationJob,
  retryMissingProjectGenerationJobOutputs,
} from "./generation";

vi.mock("@/lib/api-client", () => ({
  apiFetch: vi.fn(),
  apiRequest: vi.fn(),
}));

describe("BottomDock GenerationJob 命令 API", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it("只提交 Asset 身份、产品参数与稳定幂等键", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      generation_job_id: 9,
      cursor: 12,
    });

    await createProjectGenerationJob(
      7,
      {
        type: "image",
        input_asset_ids: [3],
        parameters: { prompt: "蓝鲸海报", aspect_ratio: "1:1" },
        expected_output_count: 4,
      },
      "command-1",
    );

    expect(apiRequest).toHaveBeenCalledWith("/api/projects/7/generation-jobs", {
      method: "POST",
      headers: { "Idempotency-Key": "command-1" },
      body: JSON.stringify({
        type: "image",
        input_asset_ids: [3],
        parameters: { prompt: "蓝鲸海报", aspect_ratio: "1:1" },
        expected_output_count: 4,
      }),
    });
  });

  it("视频也走 Project GenerationJob 命令且取消不再轮询旧 Job API", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      generation_job_id: 10,
      cursor: 13,
    });

    await createProjectGenerationJob(
      7,
      {
        type: "video",
        input_asset_ids: [3],
        parameters: {
          prompt: "蓝鲸跃出海面",
          aspect_ratio: "16:9",
          resolution: "480p",
          duration: 4,
        },
        expected_output_count: 1,
      },
      "video-command-1",
    );
    await cancelProjectGenerationJob(7, 10);

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      "/api/projects/7/generation-jobs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      "/api/projects/7/generation-jobs/10/cancel",
      { method: "POST" },
    );
  });

  it("缺失输出重试携带稳定幂等键且不提交成功槽列表", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      generation_job_id: 11,
      cursor: 14,
    });

    await retryMissingProjectGenerationJobOutputs(7, 10, "retry-command-1");

    expect(apiRequest).toHaveBeenCalledWith(
      "/api/projects/7/generation-jobs/10/retry",
      {
        method: "POST",
        headers: { "Idempotency-Key": "retry-command-1" },
      },
    );
  });
});
