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

// IKA72G：图片参考图上限读取模型能力配置（features.max_reference_images），
// 不再写死 4；无配置时回退与网关/ARK 一致的 10；字段统一 input_asset_ids。
function buildImageDeps(maxReferenceImages?: number) {
  const findOwnedById = vi.fn().mockResolvedValue({
    id: "1",
    name: "项目",
    thumb: null,
    created_at: "2026-08-18T00:00:00.000Z",
  });
  const listEnabledByType = vi.fn().mockResolvedValue([
    {
      model_id: "seedream-5.0",
      features:
        maxReferenceImages === undefined
          ? undefined
          : { max_reference_images: maxReferenceImages },
    },
  ]);
  const createJob = vi.fn().mockResolvedValue({
    generation_job_id: "1",
    cursor: 1,
  });
  const deps = {
    projects: { findOwnedById },
    models: { listEnabledByType },
    command: { createJob },
  } as unknown as HandlerDeps;
  return { deps, createJob };
}

function imageBody(refCount: number) {
  return {
    type: "image",
    expected_output_count: 1,
    parameters: {
      prompt: "海边日落",
      model_id: "seedream-5.0",
      aspect_ratio: "1:1",
    },
    input_asset_ids: Array.from({ length: refCount }, (_, i) => i + 1),
  };
}

describe("handleCreateGenerationJob 图片参考图上限（IKA72G）", () => {
  it("10 张参考图 + 能力配置 10 → 200，job.input 统一 input_asset_ids（不再写 reference_asset_ids）", async () => {
    const { deps, createJob } = buildImageDeps(10);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      imageBody(10),
      null,
      deps,
    );

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "image",
        input: expect.objectContaining({
          input_asset_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        }),
      }),
    );
    // 字段统一：job.input 不再写 reference_asset_ids
    const cmdArg = createJob.mock.calls[0]![0] as {
      input: Record<string, unknown>;
    };
    expect(cmdArg.input).not.toHaveProperty("reference_asset_ids");
  });

  it("超过能力上限（11 > 10）→ 400，文案含真实上限 10", async () => {
    const { deps, createJob } = buildImageDeps(10);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      imageBody(11),
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考图最多 10 张");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("能力配置更小（3）→ 4 张即 400，文案含模型真实上限 3", async () => {
    const { deps, createJob } = buildImageDeps(3);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      imageBody(4),
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考图最多 3 张");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("能力未配置 → 回退网关/ARK 常量 10：10 张通过、11 张 400", async () => {
    const { deps: okDeps, createJob: okCreate } = buildImageDeps();
    const ok = await handleCreateGenerationJob(
      "u1",
      "p1",
      imageBody(10),
      null,
      okDeps,
    );
    expect(ok.code).toBe(200);
    expect(okCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          input_asset_ids: expect.any(Array),
        }),
      }),
    );

    const { deps: failDeps, createJob: failCreate } = buildImageDeps();
    const fail = await handleCreateGenerationJob(
      "u1",
      "p1",
      imageBody(11),
      null,
      failDeps,
    );
    expect(fail.code).toBe(400);
    expect(fail.msg).toBe("参考图最多 10 张");
    expect(failCreate).not.toHaveBeenCalled();
  });
});
