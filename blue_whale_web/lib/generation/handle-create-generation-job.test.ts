import { describe, expect, it, vi } from "vitest";

import { handleCreateGenerationJob } from "./handle-create-generation-job.js";
import { handleCancelGenerationJob } from "./handle-cancel-generation-job.js";

// 生成命令处理器：create（建 job+日志+预留）/ cancel（软取消）。
// 对齐本仓 Java GenerationJobCommandController/Service 字段与状态语义。

function makeDeps() {
  return {
    projects: { findOwnedById: vi.fn() },
    command: {
      createJob: vi.fn(),
      requestCancel: vi.fn(),
      retryJob: vi.fn(),
      appendLog: vi.fn(),
    },
  };
}

const validBody = {
  type: "image",
  input_asset_ids: [],
  parameters: { prompt: "一只猫", aspect_ratio: "1:1", model_id: "doubao-seedream-4-0", size: "1K" },
  expected_output_count: 1,
};

describe("handleCreateGenerationJob", () => {
  it("合法 image 请求 + 归属 → 202 + {generation_job_id, cursor}", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({ generation_job_id: "200", cursor: 0 });
    const result = await handleCreateGenerationJob("9", "55", validBody, "key-1", deps);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ generation_job_id: "200", cursor: 0 });
    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "55", userId: "9", type: "image", expectedOutputCount: 1 }),
    );
  });

  it("project 不归属 → 100301", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue(null);
    const result = await handleCreateGenerationJob("9", "55", validBody, "key-1", deps);
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
    expect(deps.command.createJob).not.toHaveBeenCalled();
  });

  it("type 非法 → 400", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob("9", "55", { ...validBody, type: "3d" }, "k", deps);
    expect(result.code).toBe(400);
  });

  it("prompt 缺失 → 400", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      { type: "image", input_asset_ids: [], parameters: { aspect_ratio: "1:1" }, expected_output_count: 1 },
      "k",
      deps,
    );
    expect(result.code).toBe(400);
  });

  it("expected_output_count 超出 1-4 → 400", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      { ...validBody, expected_output_count: 8 },
      "k",
      deps,
    );
    expect(result.code).toBe(400);
  });

  it("video 参考图 > 1 → 400", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    const result = await handleCreateGenerationJob(
      "9",
      "55",
      { type: "video", input_asset_ids: [1, 2], parameters: { prompt: "x", aspect_ratio: "16:9" }, expected_output_count: 1 },
      "k",
      deps,
    );
    expect(result.code).toBe(400);
  });

  it("video 将历史 UI 模型别名规范化为 new-api 的真实 model_id", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({ generation_job_id: "201", cursor: 0 });

    await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [41],
        parameters: {
          prompt: "让图片动起来",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "k",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          model_id: "doubao-seedance-2-0-260128",
          provider_credential: "sealed-token",
          reference_asset_ids: [41],
        }),
      }),
    );
  });

  it("video 保留首帧、尾帧和普通参考素材的独立语义", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({ generation_job_id: "202", cursor: 0 });
    const body = {
      type: "video",
      input_asset_ids: [],
      first_frame_asset_id: "11",
      last_frame_asset_id: "12",
      reference_asset_ids: ["13"],
      parameters: {
        prompt: "从首帧过渡到尾帧",
        model_id: "seedance-2",
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: 5,
      },
      expected_output_count: 1,
    };

    await handleCreateGenerationJob("9", "55", body, "key-frames", deps, {
      providerCredential: "sealed-token",
    });

    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          first_frame_asset_id: "11",
          last_frame_asset_id: "12",
          reference_asset_ids: ["13"],
        }),
      }),
    );
  });

  it("video 显式首帧不会从兼容 input_asset_ids 重复投影为普通参考图", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({ generation_job_id: "203", cursor: 0 });

    await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [11],
        first_frame_asset_id: 11,
        parameters: {
          prompt: "让首帧动起来",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-first-frame",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ first_frame_asset_id: "11" }),
      }),
    );
    expect(deps.command.createJob.mock.calls[0]?.[0].input).not.toHaveProperty(
      "reference_asset_ids",
    );
  });

  it("video 从兼容 input_asset_ids 中保留首尾帧之外的普通参考素材", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({ generation_job_id: "206", cursor: 0 });

    await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [11, 13],
        first_frame_asset_id: 11,
        parameters: {
          prompt: "让首帧参考另一个素材动起来",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-first-frame-with-reference",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          first_frame_asset_id: "11",
          reference_asset_ids: ["13"],
        }),
      }),
    );
  });

  it("video 允许首尾帧之外再携带最多四个普通参考素材", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({ generation_job_id: "204", cursor: 0 });

    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [11, 12, 13, 14, 15, 16],
        first_frame_asset_id: 11,
        last_frame_asset_id: 12,
        reference_asset_ids: [13, 14, 15, 16],
        parameters: {
          prompt: "让四个参考素材约束首尾帧视频",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-six-video-assets",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(result.code).toBe(200);
    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          first_frame_asset_id: "11",
          last_frame_asset_id: "12",
          reference_asset_ids: ["13", "14", "15", "16"],
        }),
      }),
    );
  });

  it("video 显式普通参考素材交给 Worker 做 provider 能力判定", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.createJob.mockResolvedValue({ generation_job_id: "205", cursor: 0 });

    const result = await handleCreateGenerationJob(
      "9",
      "55",
      {
        type: "video",
        input_asset_ids: [13, 14],
        reference_asset_ids: [13, 14],
        parameters: {
          prompt: "用两个参考素材生成视频",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        },
        expected_output_count: 1,
      },
      "key-multi-reference-video",
      deps,
      { providerCredential: "sealed-token" },
    );

    expect(result.code).toBe(200);
    expect(deps.command.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          reference_asset_ids: ["13", "14"],
        }),
      }),
    );
  });
});

describe("handleCancelGenerationJob", () => {
  it("命中可取消任务 → 200", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.requestCancel.mockResolvedValue(true);
    const result = await handleCancelGenerationJob("9", "55", "200", deps);
    expect(result.code).toBe(200);
    expect(deps.command.requestCancel).toHaveBeenCalledWith("200", "9");
  });

  it("不可取消/不存在 → 100301", async () => {
    const deps = makeDeps();
    deps.projects.findOwnedById.mockResolvedValue({ id: "55" });
    deps.command.requestCancel.mockResolvedValue(false);
    const result = await handleCancelGenerationJob("9", "55", "999", deps);
    expect(result).toEqual({ code: 100301, msg: "资源不存在", data: null });
  });
});
