import { describe, expect, it, vi } from "vitest";

import { handleCreateGenerationJob } from "./handle-create-generation-job.js";

// IK9ILQ：音频生成接入 —— 校验分支单测。
// 通过公开入口 handleCreateGenerationJob 打私有 validate()（对齐 Java CreateGenerationJobRequest 约束）：
// 音频任务无 aspect_ratio 校验、prompt≤3000、单输出、一期不支持参考素材、model_id 白名单。

type HandlerDeps = Parameters<typeof handleCreateGenerationJob>[4];

function buildDeps() {
  const findOwnedById = vi.fn().mockResolvedValue({
    id: "1",
    name: "项目",
    thumb: null,
    created_at: "2026-08-18T00:00:00.000Z",
  });
  const listEnabledByType = vi
    .fn()
    .mockResolvedValue([{ model_id: "seed-audio-1.0" }]);
  const createJob = vi.fn().mockResolvedValue({
    generation_job_id: "1",
    cursor: 1,
  });
  const deps = {
    projects: { findOwnedById },
    models: { listEnabledByType },
    command: { createJob },
  } as unknown as HandlerDeps;
  return { deps, findOwnedById, listEnabledByType, createJob };
}

const AUDIO_BODY = {
  type: "audio",
  expected_output_count: 1,
  parameters: { prompt: "海浪", model_id: "seed-audio-1.0" },
};

describe("handleCreateGenerationJob 音频校验分支（IK9ILQ）", () => {
  it("音频任务（无 aspect_ratio）通过校验 → 200，createJob 收到音频入参", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      AUDIO_BODY,
      null,
      deps,
    );

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audio",
        expectedOutputCount: 1,
        input: expect.objectContaining({
          prompt: "海浪",
          model_id: "seed-audio-1.0",
          expected_output_count: 1,
        }),
      }),
    );
  });

  it("音频 prompt 超过 3000 字 → 400 prompt 无效，不建任务", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        type: "audio",
        expected_output_count: 1,
        parameters: { prompt: "a".repeat(3001), model_id: "seed-audio-1.0" },
      },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 expected_output_count=2 → 400（仅支持单输出）", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...AUDIO_BODY, expected_output_count: 2 },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("视频/音频生成仅支持一个输出");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频带 reference_asset_ids → 400 音频生成一期不支持参考素材", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...AUDIO_BODY, reference_asset_ids: [1] },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("音频生成一期不支持参考素材");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 model_id 不在白名单 → 400", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        type: "audio",
        expected_output_count: 1,
        parameters: { prompt: "海浪", model_id: "not-whitelisted" },
      },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("model_id 不在可用模型白名单或已停用");
    expect(createJob).not.toHaveBeenCalled();
  });
});
