import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api-client";
import {
  cancelProjectGenerationJob,
  createProjectGenerationJob,
  generateAudio,
  retryMissingProjectGenerationJobOutputs,
  listJobs,
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
        parameters: {
          prompt: "蓝鲸海报",
          aspect_ratio: "1:1",
          model_id: "doubao-seedream-5-0-260128",
          size: "2k",
          web_search: false,
          sequential_image_generation: false,
        },
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
        parameters: {
          prompt: "蓝鲸海报",
          aspect_ratio: "1:1",
          model_id: "doubao-seedream-5-0-260128",
          size: "2k",
          web_search: false,
          sequential_image_generation: false,
        },
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
          model_id: "video-model",
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

describe("listJobs", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it("ids 批量查询只发一个精确列表请求", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      records: [],
      total: 0,
      size: 2,
      current: 1,
    });
    await listJobs({ projectId: 7, jobIds: [11, 12] });
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/jobs?size=2&projectId=7&ids=11%2C12",
      {
        method: "GET",
      },
    );
  });
});

/**
 * generateAudio mock 单测（IJZXW7-B 占位）：后端无音频生成，前端 mock 兜底。
 * 验证：固定延迟后返 sample url + 假 assetId；mock 不发真 HTTP（边界）。
 */
describe("generateAudio mock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("固定延迟（1500ms）后 resolve sample url + 假 assetId", async () => {
    const p = generateAudio({
      prompt: "猫叫",
      projectId: 1,
      mode: "audio",
      modelId: "mock-audio-v1",
    });
    await vi.advanceTimersByTimeAsync(1499);
    // 未到延迟不应 resolve（此时 p 仍 pending，无法同步断言；推进到 1500）
    await vi.advanceTimersByTimeAsync(1);
    const r = await p;
    expect(r.url).toMatch(/^https:\/\/www\.soundhelix\.com\/examples\/mp3\//);
    expect(typeof r.assetId).toBe("number");
    expect(r.assetId).toBeGreaterThan(0);
  });

  it("mock 不发真 HTTP（fetch 未被调）", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    const p = generateAudio({ prompt: "x", projectId: 1, mode: "music" });
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
