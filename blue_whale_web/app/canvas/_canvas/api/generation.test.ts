import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api-client";
import { createProjectGenerationJob } from "./generation";

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
        expected_output_count: 1,
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
        expected_output_count: 1,
      }),
    });
  });
});
