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
    .mockResolvedValue([
      {
        model_id: "seed-audio-1.0",
        features: {
          audio_reference_max: 3,
          image_reference_max: 1,
          max_reference_images: 10,
        },
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
    assets: { resolveInputAssets: vi.fn().mockResolvedValue([]) },
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

  it("音频带旧字段 reference_asset_ids → 400 改走 references（IKE4GC）", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...AUDIO_BODY, reference_asset_ids: [1] },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("音频生成暂不支持旧参考字段，请使用 references");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 + 音频参考（references type:audio）→ 200，job.input 冻结 references", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...AUDIO_BODY, references: [{ role: "reference", asset_id: "42", type: "audio" }] },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audio",
        input: expect.objectContaining({
          references: [{ role: "reference", asset_id: "42", type: "audio" }],
        }),
      }),
    );
  });

  it("音频 + 图片参考（references type:image）→ 200", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...AUDIO_BODY,
        references: [{ role: "reference", asset_id: "42", type: "image" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          references: [{ role: "reference", asset_id: "42", type: "image" }],
        }),
      }),
    );
  });

  it("音频 + 素材库引用（references type:image + material_id）→ 400 音频生成不支持素材库引用", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...AUDIO_BODY,
        references: [{ role: "reference", material_id: "asset-img-1", type: "image" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("音频生成不支持素材库引用");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 + video 参考 → 400 参考素材引用无效", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...AUDIO_BODY, references: [{ role: "reference", asset_id: "42", type: "video" }] },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 + 首帧位（role:first_frame）→ 400 参考素材引用无效", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...AUDIO_BODY, references: [{ role: "first_frame", asset_id: "42", type: "image" }] },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 + 音频与图片参考混用 → 400 音频与图片参考不可混用", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...AUDIO_BODY,
        references: [
          { role: "reference", asset_id: "42", type: "audio" },
          { role: "reference", asset_id: "43", type: "image" },
        ],
      },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("音频与图片参考不可混用");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 + 音频参考超 3 个 → 400 参考音频最多 3 个", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...AUDIO_BODY,
        references: [
          { role: "reference", asset_id: "1", type: "audio" },
          { role: "reference", asset_id: "2", type: "audio" },
          { role: "reference", asset_id: "3", type: "audio" },
          { role: "reference", asset_id: "4", type: "audio" },
        ],
      },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考音频最多 3 个");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 + 图片参考超 1 个 → 400 参考图最多 1 个", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...AUDIO_BODY,
        references: [
          { role: "reference", asset_id: "1", type: "image" },
          { role: "reference", asset_id: "2", type: "image" },
        ],
      },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考图最多 1 个");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 + references + 空旧字段 input_asset_ids:[] → 200（空数组不误判为旧字段，IKE4GC）", async () => {
    const { deps, createJob } = buildDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...AUDIO_BODY,
        input_asset_ids: [],
        references: [{ role: "reference", asset_id: "42", type: "audio" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
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
  // IKE7JP：参考素材前置——resolveInputAssets 返回与请求等长的正常素材（图片参考路径。
  //  非图片参考场景各测试自 mock 覆盖）。
  const resolveInputAssets = vi.fn().mockImplementation(async (ids: string[]) =>
    ids.map((id) => ({
      id,
      type: "image",
      url: `https://tos.test/${id}.png`,
      mime: "image/png",
      size: 100,
      width: 1024,
      height: 1024,
      duration: null,
      material_id: null,
    })),
  );
  const deps = {
    projects: { findOwnedById },
    models: { listEnabledByType },
    command: { createJob },
    assets: { resolveInputAssets },
  } as unknown as HandlerDeps;
  return { deps, createJob, resolveInputAssets };
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

// 素材库引用（MaterialReference）：仅视频生成；格式校验 + 与本地 Asset 引用按并集互斥/配对。
function buildVideoDeps() {
  const findOwnedById = vi.fn().mockResolvedValue({
    id: "1",
    name: "项目",
    thumb: null,
    created_at: "2026-08-18T00:00:00.000Z",
  });
  const listEnabledByType = vi.fn().mockResolvedValue([
    { model_id: "doubao-seedance-2-0-260128" },
  ]);
  const createJob = vi.fn().mockResolvedValue({
    generation_job_id: "1",
    cursor: 1,
  });
  const deps = {
    projects: { findOwnedById },
    models: { listEnabledByType },
    command: { createJob },
    // IKFA1O：prompt_doc 复核对 references 本地 asset 查存在性与类型——按传入 id 动态返回（默认 image）
    assets: { resolveInputAssets: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, type: "image" }))) },
  } as unknown as HandlerDeps;
  return { deps, createJob };
}

const VIDEO_BODY = {
  type: "video",
  expected_output_count: 1,
  parameters: {
    prompt: "人物走过街角",
    model_id: "seedance-2",
    aspect_ratio: "16:9",
    resolution: "720p",
    duration: 8,
  },
};

describe("handleCreateGenerationJob 素材库引用（MaterialReference）", () => {
  it("视频 + reference_materials（图+视频混合）→ 200，job.input 冻结素材引用快照", async () => {
    const { deps, createJob } = buildVideoDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        reference_materials: [
          { id: "Asset-img-1", type: "image" },
          { id: "Asset-vid-2", type: "video" },
        ],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.reference_materials).toEqual([
      { id: "Asset-img-1", type: "image" },
      { id: "Asset-vid-2", type: "video" },
    ]);
    expect(cmdArg.input.first_frame_material_id).toBeUndefined();
  });

  it("视频 + 素材库首帧 → 200，input 落 first_frame_material_id", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, first_frame_material_id: "Asset-ff-1" },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.first_frame_material_id).toBe("Asset-ff-1");
  });

  it("非 video（图片）带素材库引用 → 400 素材库引用仅支持视频生成", async () => {
    const { deps, createJob } = buildImageDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        type: "image",
        expected_output_count: 1,
        parameters: {
          prompt: "海边日落",
          model_id: "seedream-5.0",
          aspect_ratio: "1:1",
        },
        reference_materials: [{ id: "Asset-img-1", type: "image" }],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("素材库引用仅支持视频生成");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("素材库首尾帧与素材库普通参考并存 → 400 首尾帧模式不能与普通参考素材混用", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        first_frame_material_id: "Asset-ff-1",
        reference_materials: [{ id: "Asset-img-2", type: "image" }],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("首尾帧模式不能与普通参考素材混用");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("素材库尾帧无首帧 → 400 尾帧必须与首帧一起使用", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, last_frame_material_id: "Asset-lf-1" },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("尾帧必须与首帧一起使用");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("同一帧位 asset 与 material 并存 → 400 首帧只能指定一个来源", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        first_frame_asset_id: "1",
        first_frame_material_id: "Asset-ff-1",
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("首帧只能指定一个来源");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("asset 首帧与素材库普通参考并存 → 400 首尾帧模式不能与普通参考素材混用", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        first_frame_asset_id: "1",
        reference_materials: [{ id: "Asset-img-2", type: "image" }],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("首尾帧模式不能与普通参考素材混用");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("素材库首帧与 asset 普通参考并存 → 400 首尾帧模式不能与普通参考素材混用", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        first_frame_material_id: "Asset-ff-1",
        reference_asset_ids: ["5"],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("首尾帧模式不能与普通参考素材混用");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("素材库引用重复 ID 去重 → 200，input 只保留一份", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        reference_materials: [
          { id: "Asset-img-1", type: "image" },
          { id: "Asset-img-1", type: "image" },
        ],
      },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.reference_materials).toEqual([
      { id: "Asset-img-1", type: "image" },
    ]);
  });

  it("素材库参考超 12 个 → 400 参考素材最多 12 个", async () => {
    const { deps, createJob } = buildVideoDeps();
    const refs = Array.from({ length: 13 }, (_, i) => ({
      id: `Asset-ref-${i}`,
      type: "image" as const,
    }));
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, reference_materials: refs },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材最多 12 个");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("素材库参考 12 图 + 3 音频 → 200（参考音频不计入 12 上限，IKDJNZ）", async () => {
    const { deps, createJob } = buildVideoDeps();
    const imageRefs = Array.from({ length: 12 }, (_, i) => ({
      id: `Asset-img-${i}`,
      type: "image" as const,
    }));
    const audioRefs = Array.from({ length: 3 }, (_, i) => ({
      id: `Asset-audio-${i}`,
      type: "audio" as const,
    }));
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        reference_materials: [...imageRefs, ...audioRefs],
      },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  it("素材库引用 ID 非法（非 Asset- 前缀）→ 400 参考素材库引用无效", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        reference_materials: [{ id: "plain-id", type: "image" }],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材库引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("素材库引用 type 非法 → 400 参考素材库引用无效", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        reference_materials: [{ id: "Asset-img-1", type: "image" }],
        first_frame_material_id: "Asset-ff-1",
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("首尾帧模式不能与普通参考素材混用");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("旧 reference_materials 支持参考音频（type=audio）→ 200 冻结且不计入 12 上限（IKDJNZ）", async () => {
    const { deps, createJob } = buildVideoDeps();
    const audioRefs = Array.from({ length: 3 }, (_, i) => ({
      id: `Asset-audio-${i}`,
      type: "audio" as const,
    }));
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        reference_materials: [
          { id: "Asset-img-1", type: "image" },
          ...audioRefs,
        ],
      },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          reference_materials: [
            { id: "Asset-img-1", type: "image" },
            { id: "Asset-audio-0", type: "audio" },
            { id: "Asset-audio-1", type: "audio" },
            { id: "Asset-audio-2", type: "audio" },
          ],
        }),
      }),
    );
  });

  it("素材库引用小写 asset- 前缀（上游真实格式）→ 200", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        reference_materials: [{ id: "asset-20260820153209-6c9z8", type: "image" }],
      },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.reference_materials).toEqual([
      { id: "asset-20260820153209-6c9z8", type: "image" },
    ]);
  });

  it("素材库首帧小写 asset- 前缀 → 200，input 落小写", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, first_frame_material_id: "asset-face-1" },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.first_frame_material_id).toBe("asset-face-1");
  });
});

describe("handleCreateGenerationJob 单数组 references（IKDJNZ）", () => {
  it("references（含本地 asset + 素材库 material，保序）→ 200，input 冻结 references 快照", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [
          { role: "first_frame", asset_id: "11", type: "image" },
          { role: "reference", asset_id: "12", type: "image" },
          { role: "reference", material_id: "Asset-ref-1", type: "video" },
          { role: "last_frame", material_id: "Asset-last-1", type: "image" },
        ],
      },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    // 单数组原样冻结（保序），旧字段不再落。
    expect(cmdArg.input.references).toEqual([
      { role: "first_frame", asset_id: "11", type: "image" },
      { role: "reference", asset_id: "12", type: "image" },
      { role: "reference", material_id: "Asset-ref-1", type: "video" },
      { role: "last_frame", material_id: "Asset-last-1", type: "image" },
    ]);
    expect(cmdArg.input.reference_asset_ids).toBeUndefined();
    expect(cmdArg.input.reference_materials).toBeUndefined();
  });

  it("references 首帧重复 → 400 首帧只能指定一个", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [
          { role: "first_frame", asset_id: "11", type: "image" },
          { role: "first_frame", asset_id: "12", type: "image" },
        ],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("首帧只能指定一个");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 有尾帧无首帧 → 400 尾帧必须与首帧一起使用", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "last_frame", material_id: "Asset-last-1", type: "image" }],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("尾帧必须与首帧一起使用");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 首尾帧带 video 类型 → 400 参考素材引用无效", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "first_frame", material_id: "Asset-ff-1", type: "video" }],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 项既无 asset_id 也无 material_id → 400 参考素材引用无效", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, references: [{ role: "reference", type: "image" }] },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 普通参考超 12 个 → 400 参考素材最多 12 个", async () => {
    const { deps, createJob } = buildVideoDeps();
    const refs = Array.from({ length: 13 }, (_, i) => ({
      role: "reference" as const,
      material_id: `Asset-ref-${i}`,
      type: "image" as const,
    }));
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, references: refs },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材最多 12 个");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 与旧参考字段混用 → 400 references 不能与旧参考字段混用", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "reference", material_id: "Asset-ref-1", type: "image" }],
        reference_asset_ids: ["5"],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("references 不能与旧参考字段混用");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 为空数组 → 400 参考素材不能为空", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, references: [] },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材不能为空");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 参考音频（type=audio, role=reference）→ 200 冻结进 input 且不占图/视频额度", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [
          { role: "reference", asset_id: "13", type: "audio" },
          { role: "reference", material_id: "asset-audio-1", type: "audio" },
        ],
      },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          references: [
            { role: "reference", asset_id: "13", type: "audio" },
            { role: "reference", material_id: "asset-audio-1", type: "audio" },
          ],
        }),
      }),
    );
  });

  it("references 首尾帧带 audio 类型 → 400 参考素材引用无效", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "first_frame", asset_id: "13", type: "audio" }],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });
});

// IKDLQF：target_node_id 文本附件（单个文本附件驱动图片生成）。
// canvas repo 以 mock 表达：合法路径断言冻结进 input 的快照与当时画布一致（edges 数组顺序），
// 非法路径断言明确失败且不建任务；无 target_node_id 时不读画布、行为完全不变。
function buildTargetDeps(canvasView: { nodes: string | null; edges: string | null }) {
  const findOwnedById = vi.fn().mockResolvedValue({
    id: "1",
    name: "项目",
    thumb: null,
    created_at: "2026-08-18T00:00:00.000Z",
  });
  const listEnabledByType = vi
    .fn()
    .mockResolvedValue([{ model_id: "seedream-5.0" }]);
  const createJob = vi.fn().mockResolvedValue({
    generation_job_id: "1",
    cursor: 1,
  });
  const getByProject = vi.fn().mockResolvedValue({
    id: "9",
    project_id: "1",
    version: 3,
    viewport: null,
    nodes: canvasView.nodes,
    edges: canvasView.edges,
  });
  const deps = {
    projects: { findOwnedById },
    models: { listEnabledByType },
    command: { createJob },
    canvas: { getByProject },
    assets: { resolveInputAssets: vi.fn().mockResolvedValue([]) },
  } as unknown as HandlerDeps;
  return { deps, createJob, getByProject };
}

const TARGET_CANVAS = {
  nodes: JSON.stringify([
    { id: "media-1", type: "mediaNode", data: { mediaType: "image" } },
    { id: "media-2", type: "mediaNode", data: { mediaType: "video" } },
    { id: "media-4", type: "mediaNode", data: { mediaType: "audio" } },
    { id: "media-3", type: "mediaNode", data: { mediaType: "image", text: "非文本节点正文" } },
    { id: "text-a", type: "textNode", data: { title: "风格", text: "赛博朋克" } },
    { id: "text-b", type: "textNode", data: { text: "雨夜" } },
    { id: "text-blank", type: "textNode", data: { title: "空白", text: "   " } },
  ]),
  edges: JSON.stringify([
    { id: "e1", source: "text-b", target: "media-1" },
    { id: "e2", source: "text-a", target: "media-1" },
    { id: "e3", source: "text-blank", target: "media-1" },
    { id: "e4", source: "text-a", target: "media-2" },
    { id: "e5", source: "media-3", target: "media-1" },
    { id: "e6", source: "text-a", target: "media-4" },
  ]),
};

const IMAGE_TARGET_BODY = {
  type: "image",
  target_node_id: "media-1",
  expected_output_count: 1,
  parameters: {
    prompt: "海边日落",
    model_id: "seedream-5.0",
    aspect_ratio: "1:1",
  },
};

describe("handleCreateGenerationJob target_node_id 文本附件（IKDLQF）", () => {
  it("合法目标 → 200，按 edges 数组顺序冻结 text_attachments 与 target_node_id", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob("u1", "p1", IMAGE_TARGET_BODY, null, deps);

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.target_node_id).toBe("media-1");
    expect(cmdArg.input.prompt).toBe("海边日落");
    // 顺序即 edges 数组顺序；缺 title 缺省 ""；空白正文照实冻结（组合时才忽略）；
    // 指向其他目标的 e4 与非 textNode 来源的 e5 不进入快照。
    expect(cmdArg.input.text_attachments).toEqual([
      { node_id: "text-b", title: "", text: "雨夜" },
      { node_id: "text-a", title: "风格", text: "赛博朋克" },
      { node_id: "text-blank", title: "空白", text: "   " },
    ]);
  });

  it("目标节点不存在 → 400 目标节点不存在或不是图片媒体节点，不建任务", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...IMAGE_TARGET_BODY, target_node_id: "media-404" }, null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("目标节点不存在或不是图片媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("目标是 textNode（非 mediaNode）→ 400，不建任务", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...IMAGE_TARGET_BODY, target_node_id: "text-a" }, null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("目标节点不存在或不是图片媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("目标是视频 mediaNode → 400，不建任务", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...IMAGE_TARGET_BODY, target_node_id: "media-2" }, null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("目标节点不存在或不是图片媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("组合后超过 30000 字 → 400 明确失败，不建任务、不截断", async () => {
    const { deps, createJob } = buildTargetDeps({
      nodes: JSON.stringify([
        { id: "media-1", type: "mediaNode", data: { mediaType: "image" } },
        { id: "text-a", type: "textNode", data: { title: "a", text: "甲".repeat(20_000) } },
        { id: "text-b", type: "textNode", data: { title: "b", text: "乙".repeat(20_000) } },
      ]),
      edges: JSON.stringify([
        { id: "e1", source: "text-a", target: "media-1" },
        { id: "e2", source: "text-b", target: "media-1" },
      ]),
    });

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...IMAGE_TARGET_BODY, parameters: { ...IMAGE_TARGET_BODY.parameters, prompt: "" } },
      null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("文本附件与提示词组合后超过 30000 字上限");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("仅附件正文、prompt 为空字符串 → 200，prompt 冻结为空串", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...IMAGE_TARGET_BODY, parameters: { ...IMAGE_TARGET_BODY.parameters, prompt: "" } },
      null, deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.prompt).toBe("");
    expect(cmdArg.input.text_attachments).toHaveLength(3);
  });

  it("附件全部空白且 prompt 为空 → 400 沿用 prompt 无效，不建任务", async () => {
    const { deps, createJob } = buildTargetDeps({
      nodes: JSON.stringify([
        { id: "media-1", type: "mediaNode", data: { mediaType: "image" } },
        { id: "text-blank", type: "textNode", data: { title: "空白", text: "  \n " } },
      ]),
      edges: JSON.stringify([{ id: "e1", source: "text-blank", target: "media-1" }]),
    });

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...IMAGE_TARGET_BODY, parameters: { ...IMAGE_TARGET_BODY.parameters, prompt: "" } },
      null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("断开后边消失：edges 为空即不消费来源，text_attachments 冻结为空数组", async () => {
    const { deps, createJob } = buildTargetDeps({ nodes: TARGET_CANVAS.nodes, edges: "[]" });

    const result = await handleCreateGenerationJob("u1", "p1", IMAGE_TARGET_BODY, null, deps);

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.target_node_id).toBe("media-1");
    expect(cmdArg.input.text_attachments).toEqual([]);
    expect(cmdArg.input.prompt).toBe("海边日落");
  });

  it("不携带 target_node_id → 不读画布，input 不含附件字段，行为不变", async () => {
    const { deps, createJob, getByProject } = buildTargetDeps(TARGET_CANVAS);
    const body = { ...IMAGE_TARGET_BODY } as Record<string, unknown>;
    delete body.target_node_id;

    const result = await handleCreateGenerationJob("u1", "p1", body, null, deps);

    expect(result.code).toBe(200);
    expect(getByProject).not.toHaveBeenCalled();
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input).not.toHaveProperty("target_node_id");
    expect(cmdArg.input).not.toHaveProperty("text_attachments");
  });
});

// IKDLQG：target_node_id 文本附件扩展到生视频目标（mediaType 为 video 的 mediaNode）。
// 快照形状与图片同构；视频既有冻结字段（resolution/duration/参考引用）保持。
function buildVideoTargetDeps(canvasView: { nodes: string | null; edges: string | null }) {
  const { deps, createJob, getByProject } = buildTargetDeps(canvasView);
  // seedance-2 经别名解析为 doubao-seedance-2-0-260128，白名单按解析后 id 校验
  (deps as { models: { listEnabledByType: unknown } }).models.listEnabledByType = vi
    .fn()
    .mockResolvedValue([{ model_id: "doubao-seedance-2-0-260128" }]);
  return { deps, createJob, getByProject };
}

const VIDEO_TARGET_BODY = {
  ...VIDEO_BODY,
  target_node_id: "media-2",
};

describe("handleCreateGenerationJob target_node_id 视频目标（IKDLQG）", () => {
  it("合法视频目标 → 200，按 edges 数组顺序冻结 text_attachments 与 target_node_id，视频参数保持", async () => {
    const { deps, createJob } = buildVideoTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob("u1", "p1", VIDEO_TARGET_BODY, null, deps);

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.target_node_id).toBe("media-2");
    expect(cmdArg.input.prompt).toBe("人物走过街角");
    // TARGET_CANVAS 中仅 e4（text-a → media-2）指向视频目标
    expect(cmdArg.input.text_attachments).toEqual([
      { node_id: "text-a", title: "风格", text: "赛博朋克" },
    ]);
    expect(cmdArg.input.model_id).toBe("doubao-seedance-2-0-260128");
    expect(cmdArg.input.resolution).toBe("720p");
    expect(cmdArg.input.duration).toBe(8);
  });

  it("目标是图片 mediaNode → 400 目标节点不存在或不是视频媒体节点，不建任务", async () => {
    const { deps, createJob } = buildVideoTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...VIDEO_TARGET_BODY, target_node_id: "media-1" }, null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("目标节点不存在或不是视频媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("目标节点不存在 → 400，不建任务", async () => {
    const { deps, createJob } = buildVideoTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...VIDEO_TARGET_BODY, target_node_id: "media-404" }, null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("目标节点不存在或不是视频媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("仅附件正文、prompt 为空字符串 → 200，prompt 冻结为空串", async () => {
    const { deps, createJob } = buildVideoTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...VIDEO_TARGET_BODY, parameters: { ...VIDEO_BODY.parameters, prompt: "" } },
      null, deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.prompt).toBe("");
    expect(cmdArg.input.text_attachments).toEqual([
      { node_id: "text-a", title: "风格", text: "赛博朋克" },
    ]);
  });

  it("附件全部空白且 prompt 为空 → 400 沿用 prompt 无效，不建任务", async () => {
    const { deps, createJob } = buildVideoTargetDeps({
      nodes: JSON.stringify([
        { id: "media-v", type: "mediaNode", data: { mediaType: "video" } },
        { id: "text-blank", type: "textNode", data: { title: "空白", text: "  \n " } },
      ]),
      edges: JSON.stringify([{ id: "e1", source: "text-blank", target: "media-v" }]),
    });

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...VIDEO_TARGET_BODY, target_node_id: "media-v", parameters: { ...VIDEO_BODY.parameters, prompt: "" } },
      null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("组合后超过 30000 字 → 400 明确失败，不建任务、不截断", async () => {
    const { deps, createJob } = buildVideoTargetDeps({
      nodes: JSON.stringify([
        { id: "media-v", type: "mediaNode", data: { mediaType: "video" } },
        { id: "text-a", type: "textNode", data: { title: "a", text: "甲".repeat(20_000) } },
        { id: "text-b", type: "textNode", data: { title: "b", text: "乙".repeat(20_000) } },
      ]),
      edges: JSON.stringify([
        { id: "e1", source: "text-a", target: "media-v" },
        { id: "e2", source: "text-b", target: "media-v" },
      ]),
    });

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...VIDEO_TARGET_BODY, target_node_id: "media-v", parameters: { ...VIDEO_BODY.parameters, prompt: "" } },
      null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("文本附件与提示词组合后超过 30000 字上限");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("断开后边消失：edges 为空即不消费来源，text_attachments 冻结为空数组", async () => {
    const { deps, createJob } = buildVideoTargetDeps({ nodes: TARGET_CANVAS.nodes, edges: "[]" });

    const result = await handleCreateGenerationJob("u1", "p1", VIDEO_TARGET_BODY, null, deps);

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.target_node_id).toBe("media-2");
    expect(cmdArg.input.text_attachments).toEqual([]);
    expect(cmdArg.input.prompt).toBe("人物走过街角");
  });

  it("不携带 target_node_id 的视频创建 → 不读画布，input 不含附件字段，行为不变", async () => {
    const { deps, createJob, getByProject } = buildVideoTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob("u1", "p1", VIDEO_BODY, null, deps);

    expect(result.code).toBe(200);
    expect(getByProject).not.toHaveBeenCalled();
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input).not.toHaveProperty("target_node_id");
    expect(cmdArg.input).not.toHaveProperty("text_attachments");
  });
});

// IKDMQT：target_node_id 扩展到生音频目标（mediaType 为 audio 的 mediaNode）。
// 音频无文本附件能力：文本连线不推导不冻结；空 prompt 无附件兜底直接 400；
// 快照落 { prompt, model_id, target_node_id }，执行与重试只读。
function buildAudioTargetDeps(canvasView: { nodes: string | null; edges: string | null }) {
  const { deps, createJob, getByProject } = buildTargetDeps(canvasView);
  (deps as { models: { listEnabledByType: unknown } }).models.listEnabledByType = vi
    .fn()
    .mockResolvedValue([{ model_id: "audio-model" }]);
  return { deps, createJob, getByProject };
}

const AUDIO_TARGET_BODY = {
  type: "audio",
  target_node_id: "media-4",
  expected_output_count: 1,
  parameters: { prompt: "哼一段轻快的旋律", model_id: "audio-model" },
};

describe("handleCreateGenerationJob target_node_id 音频目标（IKDMQT）", () => {
  it("合法音频目标 → 200 冻结 target_node_id 与文本连线全文", async () => {
    const { deps, createJob } = buildAudioTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob("u1", "p1", AUDIO_TARGET_BODY, null, deps);

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    // IKFCXE：e6（text-a → media-4）按画布边序推导冻结——附件正文与主提示词共同进入任务快照
    expect(cmdArg.input.target_node_id).toBe("media-4");
    expect(cmdArg.input.prompt).toBe("哼一段轻快的旋律");
    expect(cmdArg.input.model_id).toBe("audio-model");
    expect(cmdArg.input.text_attachments).toEqual([
      { node_id: "text-a", title: "风格", text: "赛博朋克" },
    ]);
  });

  it("目标是视频 mediaNode → 400 不是音频媒体节点，不建任务", async () => {
    const { deps, createJob } = buildAudioTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...AUDIO_TARGET_BODY, target_node_id: "media-2" }, null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("目标节点不存在或不是音频媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("空 prompt → 400 prompt 无效（音频无附件兜底），不建任务", async () => {
    const { deps, createJob } = buildAudioTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...AUDIO_TARGET_BODY, parameters: { prompt: "", model_id: "audio-model" } },
      null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("不携带 target_node_id 的音频创建 → 不读画布，input 不含 target_node_id，行为不变", async () => {
    const { deps, createJob, getByProject } = buildAudioTargetDeps(TARGET_CANVAS);
    const body = { ...AUDIO_TARGET_BODY } as Record<string, unknown>;
    delete body.target_node_id;

    const result = await handleCreateGenerationJob("u1", "p1", body, null, deps);

    expect(result.code).toBe(200);
    expect(getByProject).not.toHaveBeenCalled();
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input).not.toHaveProperty("target_node_id");
    expect(cmdArg.input).not.toHaveProperty("text_attachments");
  });
});


describe("IKDL9U review: ordinary text and provenance", () => {
  it.each(["image", "video"])("freezes HTML text and preview identity for %s", async (type) => {
    const source = { sessionId: "s1", revisionId: "r1", shotNo: 1 };
    const { deps, createJob } = buildTargetDeps({
      nodes: JSON.stringify([
        { id: "target", type: "mediaNode", data: { mediaType: type } },
        { id: "text", type: "textNode", data: { html: "<div>蓝鲸 &amp; 海</div><div>夜景</div>", promptSource: source } },
      ]),
      edges: JSON.stringify([{ id: "e", source: "text", target: "target" }]),
    });
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...IMAGE_TARGET_BODY, type, target_node_id: "target",
      parameters: { ...IMAGE_TARGET_BODY.parameters, prompt: "" },
    }, null, deps);
    expect(result.code).toBe(200);
    expect(createJob.mock.calls[0][0].input.text_attachments).toEqual([
      { node_id: "text", title: "", text: "蓝鲸 & 海\n夜景", prompt_source: source },
    ]);
  });
});

// IKE7JP：Dock 视频/图片参数前置校验——resolution/size/aspect_ratio/duration 对能力目录合法性，
// 越界在提交时 400（capability_unsupported_param + 可用值文案），不创建任务。
function buildCapabilityDeps(capabilityRows: Array<Record<string, unknown>>) {
  const findOwnedById = vi.fn().mockResolvedValue({
    id: "1",
    name: "项目",
    thumb: null,
    created_at: "2026-08-18T00:00:00.000Z",
  });
  const listEnabledByType = vi.fn().mockResolvedValue(capabilityRows);
  const createJob = vi.fn().mockResolvedValue({
    generation_job_id: "1",
    cursor: 1,
  });
  const resolveInputAssets = vi.fn().mockResolvedValue([]);
  const deps = {
    projects: { findOwnedById },
    models: { listEnabledByType },
    command: { createJob },
    assets: { resolveInputAssets },
  } as unknown as HandlerDeps;
  return { deps, createJob, resolveInputAssets };
}

const VIDEO_CAPABILITY_ROW = {
  model_id: "doubao-seedance-2-0-260128",
  supported_sizes: [
    { id: "1k", api_value: "720p" },
    { id: "2k", api_value: "1080p" },
  ],
  supported_aspect_ratios: ["16:9", "9:16"],
  supported_durations: { min: 5, max: 10, step: 5 },
  channel_parser: "seedream",
  request_mapping: null,
  default_size: "2k",
  default_aspect_ratio: "16:9",
};

const VIDEO_PARAMS_OK = {
  type: "video",
  expected_output_count: 1,
  parameters: {
    prompt: "人物走过街角",
    model_id: "doubao-seedance-2-0-260128",
    aspect_ratio: "16:9",
    resolution: "720p",
    duration: 8,
  },
};

describe("handleCreateGenerationJob 视频参数能力目录前置（IKE7JP）", () => {
  it("分辨率不在能力支持范围 → 400 capability_unsupported_resolution + 可用值文案，不建任务", async () => {
    const { deps, createJob } = buildCapabilityDeps([VIDEO_CAPABILITY_ROW]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_PARAMS_OK,
        parameters: { ...VIDEO_PARAMS_OK.parameters, resolution: "8k" },
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("capability_unsupported_resolution");
    expect(result.msg).toContain("8k");
    expect(result.msg).toContain("720p");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("比例不在能力支持范围 → 400 capability_unsupported_ratio + 可用值文案", async () => {
    const { deps, createJob } = buildCapabilityDeps([VIDEO_CAPABILITY_ROW]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_PARAMS_OK,
        parameters: { ...VIDEO_PARAMS_OK.parameters, aspect_ratio: "4:3" },
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("capability_unsupported_ratio");
    expect(result.msg).toContain("4:3");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("时长超出能力范围 → 400 capability_unsupported_duration + 范围文案", async () => {
    const { deps, createJob } = buildCapabilityDeps([VIDEO_CAPABILITY_ROW]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_PARAMS_OK,
        parameters: { ...VIDEO_PARAMS_OK.parameters, duration: 12 },
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("capability_unsupported_duration");
    expect(result.msg).toContain("12");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("合法参数 → 200 建任务（不误拦）", async () => {
    const { deps, createJob } = buildCapabilityDeps([VIDEO_CAPABILITY_ROW]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      VIDEO_PARAMS_OK,
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  // IKG0FR：上游档位命名不遵循 <N>p 时（火山 Seedance 2.0 的 4k），本地换算不出像素，
  // 但值本身在能力行白名单里——合法性由白名单负责，像素只回写资产（列可空），不得拒单。
  it("分辨率命中能力行但本地算不出像素（4k）→ 200 建任务，不误拦", async () => {
    const { deps, createJob } = buildCapabilityDeps([
      {
        ...VIDEO_CAPABILITY_ROW,
        supported_sizes: [
          { id: "1k", api_value: "720p" },
          { id: "2k", api_value: "1080p" },
          { id: "4k", api_value: "4k" },
        ],
      },
    ]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_PARAMS_OK,
        parameters: { ...VIDEO_PARAMS_OK.parameters, resolution: "4k" },
      },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
    // IKG0FR 的保证是「值原样到达 worker」，不只是「没被拒」——冻结进快照的必须是 4k 本身
    const frozen = (createJob.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(frozen.resolution).toBe("4k");
  });

  // IKG0LP：视频带音频——能力位 features.audio 允许时冻结用户选择（缺省 true）；
  // 不允许（false/未配）时快照不写该字段，worker 不下发，维持上游默认。
  it("能力位 features.audio=true → 冻结用户选择，缺省 true", async () => {
    const row = { ...VIDEO_CAPABILITY_ROW, features: { audio: true } };

    const depsA = buildCapabilityDeps([row]);
    expect(
      (await handleCreateGenerationJob("u1", "p1", VIDEO_PARAMS_OK, null, depsA.deps)).code,
    ).toBe(200);
    const inputA = (depsA.createJob.mock.calls[0][0] as { input: Record<string, unknown> })
      .input;
    expect(inputA.generate_audio).toBe(true);

    const depsB = buildCapabilityDeps([row]);
    expect(
      (
        await handleCreateGenerationJob(
          "u1",
          "p1",
          {
            ...VIDEO_PARAMS_OK,
            parameters: { ...VIDEO_PARAMS_OK.parameters, generate_audio: false },
          },
          null,
          depsB.deps,
        )
      ).code,
    ).toBe(200);
    const inputB = (depsB.createJob.mock.calls[0][0] as { input: Record<string, unknown> })
      .input;
    expect(inputB.generate_audio).toBe(false);
  });

  it("能力位未配 features.audio → 快照不写 generate_audio（出站维持上游默认）", async () => {
    const { deps, createJob } = buildCapabilityDeps([VIDEO_CAPABILITY_ROW]);
    expect(
      (await handleCreateGenerationJob("u1", "p1", VIDEO_PARAMS_OK, null, deps)).code,
    ).toBe(200);
    const input = (createJob.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(Object.hasOwn(input, "generate_audio")).toBe(false);
  });

  it("能力行未配置 supported_* 时不阻断（worker 兜底）", async () => {
    const { deps, createJob } = buildCapabilityDeps([
      { model_id: "doubao-seedance-2-0-260128" },
    ]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      VIDEO_PARAMS_OK,
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });
});

// IKE7JP：图片 size×ratio 交叉格前置——GPT 交叉格未填 / banana 一维映射缺失的组合
// 在提交时 400（invalid_input），与 worker mapImageChannelRequest 同码同文案。
const GPT_IMAGE_CAPABILITY = {
  model_id: "gpt-image-1",
  supported_sizes: [{ id: "1k", api_value: "1024x1024" }],
  supported_aspect_ratios: ["1:1", "16:9"],
  supported_durations: null,
  channel_parser: "gpt",
  request_mapping: {
    matrix: { "1k": { "1:1": "1024x1024" } }, // 16:9 交叉格未填
  },
  default_size: "1k",
  default_aspect_ratio: "1:1",
};

function gptImageBody(aspectRatio: string) {
  return {
    type: "image",
    expected_output_count: 1,
    parameters: {
      prompt: "海边日落",
      model_id: "gpt-image-1",
      aspect_ratio: aspectRatio,
      size: "1k",
    },
  };
}

describe("handleCreateGenerationJob 图片交叉格前置（IKE7JP）", () => {
  it("GPT 交叉格已填组合 → 200 建任务", async () => {
    const { deps, createJob } = buildCapabilityDeps([GPT_IMAGE_CAPABILITY]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      gptImageBody("1:1"),
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  it("GPT 交叉格与默认格都缺失 → 400 invalid_reference_type（模型、分辨率与宽高比组合不受支持）", async () => {
    // 请求组合 1k×16:9 未填；默认格也缺失（default_size 不在 matrix）→ 无回退，400。
    const badCapability = {
      ...GPT_IMAGE_CAPABILITY,
      default_size: "2k",
      default_aspect_ratio: "16:9",
    };
    const { deps, createJob } = buildCapabilityDeps([badCapability]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      gptImageBody("16:9"),
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference_type");
    expect(result.msg).toBe("模型、分辨率与宽高比组合不受支持");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("GPT 交叉格未填但默认格可回退 → 200（与 worker mapImageChannelRequest 同源）", async () => {
    const { deps, createJob } = buildCapabilityDeps([GPT_IMAGE_CAPABILITY]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      gptImageBody("16:9"),
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });
});

// IKE7JP：参考素材前置——提交时复用 worker resolveInputAssets 查存在性/类型。
describe("handleCreateGenerationJob 参考素材前置（IKE7JP）", () => {
  it("参考素材存在且类型匹配 → 200 建任务", async () => {
    const { deps, createJob, resolveInputAssets } = buildCapabilityDeps([VIDEO_CAPABILITY_ROW]);
    resolveInputAssets.mockResolvedValue([
      { id: "1", type: "image", url: "https://tos.test/1.png", mime: "image/png", size: 100, width: 1024, height: 1024, duration: null, material_id: null },
    ]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_PARAMS_OK,
        reference_asset_ids: ["1"],
      },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  it("参考素材不存在（resolve 返回空）→ 400 invalid_reference", async () => {
    const { deps, createJob, resolveInputAssets } = buildCapabilityDeps([VIDEO_CAPABILITY_ROW]);
    resolveInputAssets.mockResolvedValue([]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_PARAMS_OK,
        reference_asset_ids: ["999"],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference");
    expect(result.msg).toBe("参考素材不存在或无权访问");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("图片参考类型非图片 → 400 参考素材必须是图片", async () => {
    const { deps, createJob, resolveInputAssets } = buildCapabilityDeps([GPT_IMAGE_CAPABILITY]);
    resolveInputAssets.mockResolvedValue([
      { id: "1", type: "video", url: "https://tos.test/1.mp4", mime: "video/mp4", size: 100, width: 1280, height: 720, duration: 5, material_id: null },
    ]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...gptImageBody("1:1"), input_asset_ids: ["1"] },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference_type");
    expect(result.msg).toBe("参考素材必须是图片");
    expect(createJob).not.toHaveBeenCalled();
  });
});

// IKG57P：素材软删后提交未被方案级校验拦截——8453e04a 把 freezePromptPlans（planError：
// 规格 7.2 文案 + #N 索引，抛 BadRequestException）挪到通用存在性检查之后，软删素材先命中
// 通用检查的信封 fail 被短路。修复为合并语义：通用检查发现缺失且正文标签引用了缺失素材时，
// 按 planError 同源形态抛规格文案与具体索引；纯参考清单维持通用文案信封（HTTP 投影在 controller）。
describe("handleCreateGenerationJob 素材软删提交拦截（IKG57P）", () => {
  const MISSING_REF_MSG = "提示词引用的素材缺失或不完整，请补充素材或移除对应引用后再生成";

  it("正文标签引用的素材被软删 → 抛 BadRequestException：规格文案 + 索引 #N，不建任务", async () => {
    const { deps, createJob, resolveInputAssets } = buildImageDeps();
    resolveInputAssets.mockImplementation(async (ids: string[]) =>
      ids.filter((id) => id !== "2").map((id) => ({
        id,
        type: "image",
        url: `https://tos.test/${id}.png`,
        mime: "image/png",
        size: 100,
        width: 1024,
        height: 1024,
        duration: null,
        material_id: null,
      })),
    );
    await expect(
      handleCreateGenerationJob(
        "u1",
        "p1",
        {
          ...imageBody(2),
          prompt_doc: {
            version: 1,
            segments: [
              { kind: "text", text: "让" },
              { kind: "asset_ref", asset_id: "2" },
              { kind: "text", text: "微笑" },
            ],
          },
        },
        null,
        deps,
      ),
    ).rejects.toMatchObject({ message: `索引 #2：${MISSING_REF_MSG}` });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("多个引用素材缺失 → 索引按输入顺序逐一列出（#1、#2）", async () => {
    const { deps, createJob, resolveInputAssets } = buildImageDeps();
    resolveInputAssets.mockResolvedValue([]);
    await expect(
      handleCreateGenerationJob(
        "u1",
        "p1",
        {
          ...imageBody(2),
          prompt_doc: {
            version: 1,
            segments: [
              { kind: "asset_ref", asset_id: "1" },
              { kind: "text", text: "和" },
              { kind: "asset_ref", asset_id: "2" },
            ],
          },
        },
        null,
        deps,
      ),
    ).rejects.toMatchObject({ message: `索引 #1、#2：${MISSING_REF_MSG}` });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("纯参考清单（无正文标签）素材软删 → 维持通用文案信封 400 invalid_reference", async () => {
    const { deps, createJob, resolveInputAssets } = buildImageDeps();
    resolveInputAssets.mockResolvedValue([]);
    const result = await handleCreateGenerationJob("u1", "p1", imageBody(1), null, deps);
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference");
    expect(result.msg).toBe("参考素材不存在或无权访问");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("视频正文标签引用的素材被软删 → 同口径拦截（普通参考同类型编号）", async () => {
    const { deps, createJob } = buildVideoDeps();
    vi.mocked(deps.assets.resolveInputAssets).mockImplementation(
      async (ids: string[]) => ids.filter((id) => id !== "2").map((id) => ({ id, type: "image" })),
    );
    await expect(
      handleCreateGenerationJob(
        "u1",
        "p1",
        {
          ...VIDEO_BODY,
          references: [
            { role: "first_frame", asset_id: "101", type: "image" },
            { role: "last_frame", asset_id: "102", type: "image" },
            { role: "reference", asset_id: "1", type: "image" },
            { role: "reference", asset_id: "2", type: "image" },
          ],
          prompt_doc: {
            version: 1,
            segments: [
              { kind: "text", text: "让" },
              { kind: "asset_ref", asset_id: "2" },
              { kind: "text", text: "的人物微笑" },
            ],
          },
        },
        null,
        deps,
      ),
    ).rejects.toMatchObject({ message: `索引 #2：${MISSING_REF_MSG}` });
    expect(createJob).not.toHaveBeenCalled();
  });
});

// IKESD6 / ADR-0085：raw prompt 上限跟随模型目录 features.max_prompt_length，
// 缺省回落旧硬编码（image/video 4000 / audio 3000）；错误码与文案不变。
describe("handleCreateGenerationJob 按模型提示词上限（IKESD6）", () => {
  function promptOf(len: number) {
    return "a".repeat(len);
  }

  function imageBodyWithPrompt(prompt: string) {
    return {
      type: "image",
      expected_output_count: 1,
      parameters: { prompt, model_id: "gpt-image-2-text-to-image", aspect_ratio: "1:1" },
    };
  }

  it("max_prompt_length=32000：5000 字 prompt → 200（旧 4000 硬编码会误拒）", async () => {
    const { deps, createJob } = buildCapabilityDeps([
      { model_id: "gpt-image-2-text-to-image", features: { max_prompt_length: 32000 } },
    ]);

    const result = await handleCreateGenerationJob(
      "u1", "p1", imageBodyWithPrompt(promptOf(5000)), null, deps,
    );

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  it("max_prompt_length=32000：32001 字 → 400 prompt 无效", async () => {
    const { deps, createJob } = buildCapabilityDeps([
      { model_id: "gpt-image-2-text-to-image", features: { max_prompt_length: 32000 } },
    ]);

    const result = await handleCreateGenerationJob(
      "u1", "p1", imageBodyWithPrompt(promptOf(32001)), null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("未配置：4001 字 → 400（缺省回落旧硬编码，行为回归）", async () => {
    const { deps, createJob } = buildCapabilityDeps([
      { model_id: "gpt-image-2-text-to-image", features: { reference_image: true } },
    ]);

    const result = await handleCreateGenerationJob(
      "u1", "p1", imageBodyWithPrompt(promptOf(4001)), null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("配置收紧（500）：501 字 → 400，500 字 → 200", async () => {
    const { deps, createJob } = buildCapabilityDeps([
      { model_id: "gpt-image-2-text-to-image", features: { max_prompt_length: 500 } },
    ]);

    const over = await handleCreateGenerationJob(
      "u1", "p1", imageBodyWithPrompt(promptOf(501)), null, deps,
    );
    const exact = await handleCreateGenerationJob(
      "u1", "p1", imageBodyWithPrompt(promptOf(500)), null, deps,
    );

    expect(over.code).toBe(400);
    expect(exact.code).toBe(200);
  });
});

// IKESD6 / ADR-0085：组合闸取 max(契约预算 30000, 模型值)——配了 32000 的模型
// 挂文本附件不应先撞 30000（否则配置形同虚设）。
describe("handleCreateGenerationJob 组合上限跟随模型值（IKESD6）", () => {
  function buildTargetDepsWithPromptCap(opts: {
    maxPromptLength?: number;
    attachLen: number;
  }) {
    const findOwnedById = vi.fn().mockResolvedValue({ id: "1" });
    const listEnabledByType = vi.fn().mockResolvedValue([
      {
        model_id: "seedream-5.0",
        features: opts.maxPromptLength
          ? { max_prompt_length: opts.maxPromptLength }
          : undefined,
      },
    ]);
    const createJob = vi.fn().mockResolvedValue({ generation_job_id: "1", cursor: 1 });
    const getByProject = vi.fn().mockResolvedValue({
      id: "9",
      project_id: "1",
      version: 3,
      viewport: null,
      nodes: JSON.stringify([
        { id: "media-1", type: "mediaNode", data: { mediaType: "image" } },
        { id: "text-a", type: "textNode", data: { title: "a", text: "甲".repeat(opts.attachLen) } },
        { id: "text-b", type: "textNode", data: { title: "b", text: "乙".repeat(opts.attachLen) } },
      ]),
      edges: JSON.stringify([
        { id: "e1", source: "text-a", target: "media-1" },
        { id: "e2", source: "text-b", target: "media-1" },
      ]),
    });
    const deps = {
      projects: { findOwnedById },
      models: { listEnabledByType },
      command: { createJob },
      canvas: { getByProject },
      assets: { resolveInputAssets: vi.fn().mockResolvedValue([]) },
    } as unknown as HandlerDeps;
    return { deps, createJob };
  }

  function emptyPromptOnTarget() {
    return {
      ...IMAGE_TARGET_BODY,
      parameters: { ...IMAGE_TARGET_BODY.parameters, prompt: "" },
    };
  }

  it("模型 32000：组合 30002（>旧闸 30000，≤模型值）→ 200 放行", async () => {
    const { deps, createJob } = buildTargetDepsWithPromptCap({
      maxPromptLength: 32_000,
      attachLen: 15_000,
    });

    const result = await handleCreateGenerationJob("u1", "p1", emptyPromptOnTarget(), null, deps);

    // 30000 + 2 个换行连接符 = 30002：旧组合闸必拒，跟随模型值后放行。
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  it("模型 32000：组合 40002 超闸 → 400 且文案上限取模型值", async () => {
    const { deps, createJob } = buildTargetDepsWithPromptCap({
      maxPromptLength: 32_000,
      attachLen: 20_000,
    });

    const result = await handleCreateGenerationJob("u1", "p1", emptyPromptOnTarget(), null, deps);

    expect(result.code).toBe(400);
    expect(result.msg).toBe("文本附件与提示词组合后超过 32000 字上限");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("未配置：30002 组合仍撞旧闸 30000（回归）", async () => {
    const { deps, createJob } = buildTargetDepsWithPromptCap({ attachLen: 15_000 });

    const result = await handleCreateGenerationJob("u1", "p1", emptyPromptOnTarget(), null, deps);

    expect(result.code).toBe(400);
    expect(result.msg).toBe("文本附件与提示词组合后超过 30000 字上限");
    expect(createJob).not.toHaveBeenCalled();
  });
});

// IKFA1M：正文素材标签（prompt_doc）——结构/版本校验、失效与无效身份复核、编译冻结。
describe("handleCreateGenerationJob 正文素材标签 prompt_doc（IKFA1M）", () => {
  it.each([{ text: "", name: "空串" }, { text: " ", name: "空白" }, { text: "a".repeat(4001), name: "4001字" }])("拒绝空白或超长权威正文：$name", async ({ text }) => {
    const { deps, createJob } = buildImageDeps();
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...imageBody(0),
      prompt_doc: { version: 1, segments: [{ kind: "text", text }] },
    }, null, deps);
    expect(result.code).toBe(400);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("目标没有文本附件时，空权威正文不能借非空镜像创建任务", async () => {
    const { deps, createJob } = buildTargetDeps({ nodes: TARGET_CANVAS.nodes, edges: "[]" });
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...IMAGE_TARGET_BODY,
      prompt_doc: { version: 1, segments: [] },
    }, null, deps);
    expect(result.code).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("目标有文本附件时仍允许空权威正文", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...IMAGE_TARGET_BODY,
      prompt_doc: { version: 1, segments: [] },
    }, null, deps);
    expect(result.code).toBe(200);
    expect(createJob.mock.calls[0][0].input.prompt).toBe("");
    expect(createJob.mock.calls[0][0].input.text_attachments.length).toBeGreaterThan(0);
  });

  const DOC = {
    version: 1,
    segments: [
      { kind: "text", text: "让" },
      { kind: "asset_ref", asset_id: "2" },
      { kind: "text", text: "穿上" },
      { kind: "asset_ref", asset_id: "1" },
      { kind: "text", text: "的衣服，再让" },
      { kind: "asset_ref", asset_id: "2" },
      { kind: "text", text: "微笑" },
    ],
  } as const;

  it("合法 prompt_doc → 200：按真实输入顺序编译正文并冻结原始结构（D1/A4）", async () => {
    const { deps, createJob } = buildImageDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...imageBody(2), prompt_doc: DOC },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    // 正文先提图片2 再提图片1；媒体顺序仍 input_asset_ids = [1, 2]
    expect(cmdArg.input.prompt).toBe("让图片2穿上图片1的衣服，再让图片2微笑");
    expect(cmdArg.input.prompt_doc).toEqual(DOC);
    expect(cmdArg.input.input_asset_ids).toEqual([1, 2]);
  });

  it("无 prompt_doc → input 不带该字段，prompt 原样冻结（旧行为/E5）", async () => {
    const { deps, createJob } = buildImageDeps();
    const result = await handleCreateGenerationJob("u1", "p1", imageBody(1), null, deps);
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.prompt).toBe("海边日落");
    expect(cmdArg.input).not.toHaveProperty("prompt_doc");
  });

  it("失效标签（invalid_label）→ 400 invalid_reference，不建任务", async () => {
    const { deps, createJob } = buildImageDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...imageBody(2),
        prompt_doc: {
          version: 1,
          segments: [{ kind: "asset_ref", asset_id: "2", invalid_label: "图片2" }],
        },
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("标签指向不在最终输入集合的身份 → 400 invalid_reference（服务端复核引用关系，D4）", async () => {
    const { deps, createJob } = buildImageDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...imageBody(1), prompt_doc: DOC }, // DOC 引用 asset 2，但 input_asset_ids 只有 [1]
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference");
    // IKG57P：正文索引引用缺失同样拦截（素材从参考清单移除不是绕过理由）——文案锚定
    expect(result.msg).toBe("正文素材标签指向无效的参考素材");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("结构/版本非法 → 400 invalid_input", async () => {
    const { deps, createJob } = buildImageDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...imageBody(1), prompt_doc: { version: 2, segments: [] } },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_input");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频纯文本 prompt_doc 可接纳且冻结结构", async () => {
    const { deps, createJob } = buildDeps();
    const doc = { version: 1, segments: [{ kind: "text", text: "海浪声" }] };
    const result = await handleCreateGenerationJob("u1", "p1", { ...AUDIO_BODY, prompt_doc: doc }, null, deps);
    expect(result.code).toBe(200);
    expect(createJob.mock.calls[0][0].input).toMatchObject({ prompt: "海浪声", prompt_doc: doc });
  });
});

// IKFA1O：生视频正文素材标签——多媒体/首尾帧角色编译、素材库身份、快照冻结与旧任务兼容。
describe("handleCreateGenerationJob 视频正文素材标签 prompt_doc（IKFA1O）", () => {
  const VIDEO_DOC = {
    version: 1,
    segments: [
      { kind: "text", text: "让" },
      { kind: "asset_ref", asset_id: "2" },
      { kind: "text", text: "的人物从" },
      { kind: "asset_ref", asset_id: "101" },
      { kind: "text", text: "走向" },
      { kind: "asset_ref", asset_id: "102" },
      { kind: "text", text: "，参考" },
      { kind: "asset_ref", asset_id: "asset-v1" },
      { kind: "text", text: "的运镜" },
    ],
  } as const;

  /** 帧在前、普通参考保序（与 buildVideoJobReferences 同构）：首帧/尾帧 + 图片/图片/视频(素材库) */
  const VIDEO_REFS = [
    { role: "first_frame", asset_id: "101", type: "image" },
    { role: "last_frame", asset_id: "102", type: "image" },
    { role: "reference", asset_id: "1", type: "image" },
    { role: "reference", asset_id: "2", type: "image" },
    { role: "reference", material_id: "asset-v1", type: "video" },
  ] as const;

  it("合法 prompt_doc → 200：帧按角色、普通参考同类型编号编译，快照冻结原始结构（C1/A2）", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, references: VIDEO_REFS, prompt_doc: VIDEO_DOC },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    // 帧身份编译为角色名；普通参考图片 1/2 同类型编号；素材库身份参与视频编号
    expect(cmdArg.input.prompt).toBe("让图片2的人物从首帧走向尾帧，参考视频1的运镜");
    expect(cmdArg.input.prompt_doc).toEqual(VIDEO_DOC);
    expect(cmdArg.input.references).toEqual(VIDEO_REFS);
  });

  it("失效标签（invalid_label，含模式不兼容场景）→ 400 invalid_reference，不建任务（C2/D4）", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: VIDEO_REFS,
        prompt_doc: {
          version: 1,
          segments: [{ kind: "asset_ref", asset_id: "2", invalid_label: "图片1" }],
        },
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("标签身份不在 references（asset_id ∪ material_id）→ 400 invalid_reference", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: VIDEO_REFS,
        prompt_doc: {
          version: 1,
          segments: [{ kind: "asset_ref", asset_id: "999" }],
        },
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("携带 prompt_doc 但未走单数组 references（旧字段路径）→ 400 unsupported_input", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, prompt_doc: VIDEO_DOC },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("unsupported_input");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("无 prompt_doc 的旧视频任务 → 行为不变：input 不带该字段，prompt 原样冻结（E5）", async () => {
    const { deps, createJob } = buildVideoDeps();
    const result = await handleCreateGenerationJob("u1", "p1", { ...VIDEO_BODY, references: VIDEO_REFS }, null, deps);
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.prompt).toBe("人物走过街角");
    expect(cmdArg.input).not.toHaveProperty("prompt_doc");
  });
});

// IKFA1M 合并边界：权威正文必须同时遵循 release 的模型长度能力。
it.each([32000, 32001])("结构化正文遵循模型 32000 字边界：%i", async (length) => {
  const { deps, createJob } = buildCapabilityDeps([
    { model_id: "gpt-image-2-text-to-image", features: { max_prompt_length: 32000 } },
  ]);
  const result = await handleCreateGenerationJob("u1", "p1", {
    type: "image", expected_output_count: 1,
    parameters: { prompt: "合法镜像", model_id: "gpt-image-2-text-to-image", aspect_ratio: "1:1" },
    prompt_doc: { version: 1, segments: [{ kind: "text", text: "a".repeat(length) }] },
  }, null, deps);
  expect(result.code).toBe(length === 32000 ? 200 : 400);
  expect(createJob).toHaveBeenCalledTimes(length === 32000 ? 1 : 0);
});

/* IKFA1P：文本附件正文标签——文本身份复核（画布连线推导）、文本N 编译、
   composed_prompt 编号清单冻结。语义权威：docs/specs/2026-09-13-ikfa1p-text-attachment-prompt-ref-contract.md */

describe("handleCreateGenerationJob 文本附件正文标签 prompt_doc（IKFA1P）", () => {
  /** media-1 附件顺序（edges 序）：[text-b(雨夜), text-a(赛博朋克), text-blank(空白)] */
  const TEXT_DOC = {
    version: 1,
    segments: [
      { kind: "text", text: "按" },
      { kind: "text_ref", node_id: "text-a" },
      { kind: "text", text: "修改，参考" },
      { kind: "text_ref", node_id: "text-b" },
      { kind: "text", text: "与空白附件" },
      { kind: "text_ref", node_id: "text-blank" },
    ],
  } as const;

  it("生图：文本+媒体混排合法 → 200，正文按附件顺序编译文本N（D2/E4）", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...IMAGE_TARGET_BODY,
      prompt_doc: TEXT_DOC,
    }, null, deps);
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    // 编号跟附件顺序（text-b→文本1、text-a→文本2、text-blank→文本3），不跟正文出现顺序
    expect(cmdArg.input.prompt).toBe("按文本2修改，参考文本1与空白附件文本3");
    expect(cmdArg.input.prompt_doc).toEqual(TEXT_DOC);
    // IKG6EK / ADR-0088：编号清单组合（文本N：<正文> + 正文）已移交前端——后端不再冻结
    // composed_prompt，也不再替前端拼装附件正文；worker 只读 input.prompt。
    expect(cmdArg.input).not.toHaveProperty("composed_prompt");
  });

  it("生图：文本身份不在附件集合 → 400 invalid_reference，不建任务（D4）", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...IMAGE_TARGET_BODY,
      prompt_doc: { version: 1, segments: [{ kind: "text_ref", node_id: "text-gone" }] },
    }, null, deps);
    expect(result.code).toBe(400);
    expect(result.msg).toBe("正文文本标签指向无效的文本附件");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("生图：正文含文本标签但未携带 target_node_id → 400（文本附件由目标连线推导）", async () => {
    const { deps, createJob } = buildImageDeps();
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...imageBody(0),
      prompt_doc: { version: 1, segments: [{ kind: "text_ref", node_id: "text-a" }] },
    }, null, deps);
    expect(result.code).toBe(400);
    expect(result.msg).toBe("正文文本标签指向无效的文本附件");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("生图：文本失效标签（invalid_label）→ 400 存在已失效的素材标签（阻止生成）", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...IMAGE_TARGET_BODY,
      prompt_doc: { version: 1, segments: [{ kind: "text_ref", node_id: "text-a", invalid_label: "文本2" }] },
    }, null, deps);
    expect(result.code).toBe(400);
    expect(result.msg).toBe("存在已失效的素材标签，请删除后再提交");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("生图：无文本标签的 prompt_doc → input 不冻结 composed_prompt（组合格式不变，回归）", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...IMAGE_TARGET_BODY,
      prompt_doc: { version: 1, segments: [{ kind: "text", text: "海边日落" }] },
    }, null, deps);
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input).not.toHaveProperty("composed_prompt");
  });

  /** 视频目标画布：media-v 的附件顺序 [text-x, text-y] */
  const VIDEO_TEXT_CANVAS = {
    nodes: JSON.stringify([
      { id: "media-v", type: "mediaNode", data: { mediaType: "video" } },
      { id: "text-x", type: "textNode", data: { title: "运镜", text: "手持跟拍" } },
      { id: "text-y", type: "textNode", data: { title: "风格", text: "胶片感" } },
    ]),
    edges: JSON.stringify([
      { id: "e1", source: "text-x", target: "media-v" },
      { id: "e2", source: "text-y", target: "media-v" },
    ]),
  };

  function buildVideoTargetDeps() {
    const { deps, createJob } = buildVideoDeps();
    const canvasDeps = buildTargetDeps(VIDEO_TEXT_CANVAS);
    (deps as unknown as { canvas: unknown }).canvas = canvasDeps.getByProject ? { getByProject: canvasDeps.getByProject } : undefined;
    // buildVideoDeps 的模型目录只含视频模型；canvas 直接注入
    return { deps, createJob };
  }

  it("视频仅文本标签：不传媒体 references 也能冻结完整文本（IKFA1J）", async () => {
    const { deps, createJob } = buildVideoTargetDeps();
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...VIDEO_BODY,
      target_node_id: "media-v",
      prompt_doc: { version: 1, segments: [{ kind: "text_ref", node_id: "text-x" }] },
    }, null, deps);
    expect(result.code).toBe(200);
    const input = createJob.mock.calls[0][0].input;
    expect(input.prompt).toBe("文本1");
    // IKG6EK / ADR-0088：编号清单组合移交前端，后端不再冻结 composed_prompt
    expect(input).not.toHaveProperty("composed_prompt");
    expect(input).not.toHaveProperty("references");
  });

  it.each([
    { node_id: "text-none" },
    { node_id: "text-x", invalid_label: "文本1" },
  ])("视频仅文本标签仍拒绝无效身份 %j（IKFA1J）", async (ref) => {
    const { deps, createJob } = buildVideoTargetDeps();
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...VIDEO_BODY,
      target_node_id: "media-v",
      prompt_doc: { version: 1, segments: [{ kind: "text_ref", ...ref }] },
    }, null, deps);
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference");
    expect(createJob).not.toHaveBeenCalled();
  });

  it.each([
    ["image", "reorder"], ["image", "remove"],
    ["video", "reorder"], ["video", "remove"],
  ])("%s：文本附件并发 %s 不得使标签与冻结正文错配（IKFA1J）", async (type, change) => {
    const video = type === "video";
    const initial = video ? VIDEO_TEXT_CANVAS : TARGET_CANVAS;
    const { deps, createJob, getByProject } = buildTargetDeps(initial);
    if (video) deps.models = buildVideoDeps().deps.models;
    const mentioned = video ? "text-x" : "text-b";
    const edges = JSON.parse(initial.edges) as Array<{ source: string }>;
    const changed = {
      ...initial,
      edges: JSON.stringify(change === "remove"
        ? edges.filter((edge) => edge.source !== mentioned)
        : [...edges].reverse()),
    };
    // 模拟读取后其他请求更新画布；若接纳二次读取，将拿到另一个版本。
    getByProject.mockResolvedValueOnce({ ...initial, version: 3 })
      .mockResolvedValue({ ...changed, version: 4 });
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...(video ? { ...VIDEO_BODY, target_node_id: "media-v" } : IMAGE_TARGET_BODY),
      prompt_doc: { version: 1, segments: [{ kind: "text_ref", node_id: mentioned }] },
    }, null, deps);
    expect(result.code).toBe(200);
    const input = createJob.mock.calls[0][0].input;
    expect(input.prompt).toBe("文本1");
    expect(input.text_attachments[0]).toEqual(expect.objectContaining({
      node_id: mentioned, text: video ? "手持跟拍" : "雨夜",
    }));
    // IKG6EK / ADR-0088：编号清单组合移交前端，后端不再冻结 composed_prompt
    expect(input).not.toHaveProperty("composed_prompt");
  });

  it("视频：references + 文本标签 → 200，帧/参考与文本N 混排编译", async () => {
    const { deps, createJob } = buildVideoTargetDeps();
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...VIDEO_BODY,
      target_node_id: "media-v",
      references: [{ role: "reference", asset_id: "1", type: "image" }],
      prompt_doc: {
        version: 1,
        segments: [
          { kind: "text", text: "让图片1按" },
          { kind: "text_ref", node_id: "text-y" },
          { kind: "text", text: "调整，再参考" },
          { kind: "text_ref", node_id: "text-x" },
        ],
      },
    }, null, deps);
    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.prompt).toBe("让图片1按文本2调整，再参考文本1");
    // IKG6EK / ADR-0088：编号清单组合移交前端，后端不再冻结 composed_prompt
    expect(cmdArg.input).not.toHaveProperty("composed_prompt");
    expect(cmdArg.input.text_attachments).toEqual([
      { node_id: "text-x", title: "运镜", text: "手持跟拍" },
      { node_id: "text-y", title: "风格", text: "胶片感" },
    ]);
  });

  it("视频：文本身份不在附件集合 → 400 invalid_reference，不建任务", async () => {
    const { deps, createJob } = buildVideoTargetDeps();
    const result = await handleCreateGenerationJob("u1", "p1", {
      ...VIDEO_BODY,
      target_node_id: "media-v",
      references: [{ role: "reference", asset_id: "1", type: "image" }],
      prompt_doc: { version: 1, segments: [{ kind: "text_ref", node_id: "text-none" }] },
    }, null, deps);
    expect(result.code).toBe(400);
    expect(result.msg).toBe("正文文本标签指向无效的文本附件");
    expect(createJob).not.toHaveBeenCalled();
  });
});

 describe('IKFCJG 音频正文引用接纳', () => {
  it('音频 asset_ref 按 references 编号编译并冻结', async () => {
    const { deps, createJob } = buildDeps();
    vi.mocked(deps.assets.resolveInputAssets).mockResolvedValue([{ type: 'audio' }] as never);
    const doc = { version: 1, segments: [{ kind: 'asset_ref', asset_id: '42', label: '伪造编号' }] };
    const result = await handleCreateGenerationJob('u1', 'p1', { ...AUDIO_BODY, references: [{ role: 'reference', asset_id: '42', type: 'audio' }], prompt_doc: doc }, null, deps);
    expect(result.code).toBe(200);
    expect(createJob.mock.calls[0][0].input).toMatchObject({ prompt: '音频1', prompt_doc: doc });
  });
  it('音频 text_ref 冻结权威全文', async () => {
    const { deps, createJob } = buildAudioTargetDeps(TARGET_CANVAS);
    const doc = { version: 1, segments: [{ kind: 'text_ref', node_id: 'text-a' }] };
    const result = await handleCreateGenerationJob('u1', 'p1', { ...AUDIO_TARGET_BODY, prompt_doc: doc }, null, deps);
    expect(result.code).toBe(200);
    // IKG6EK / ADR-0088：编号清单组合移交前端，后端不再冻结 composed_prompt
    expect(createJob.mock.calls[0][0].input).toMatchObject({ prompt: '文本1', prompt_doc: doc });
    expect(createJob.mock.calls[0][0].input).not.toHaveProperty('composed_prompt');
  });
});

 describe('IKFCJG 音频正文安全校验', () => {
  it.each([
    { name: '未引用素材', segment: { kind: 'asset_ref', asset_id: '99' }, actualType: 'audio', error: 'invalid_reference' },
    { name: '伪造类型', segment: { kind: 'asset_ref', asset_id: '42' }, actualType: 'image', error: 'invalid_reference_type' },
    { name: '失效标签', segment: { kind: 'asset_ref', asset_id: '42', invalid_label: '音频1' }, actualType: 'audio', error: 'invalid_reference' },
  ])('$name 拒绝且不创建任务', async ({ segment, actualType, error }) => {
    const { deps, createJob } = buildDeps();
    vi.mocked(deps.assets.resolveInputAssets).mockResolvedValue([{ type: actualType }] as never);
    const result = await handleCreateGenerationJob('u1', 'p1', { ...AUDIO_BODY,
      references: [{ role: 'reference', asset_id: '42', type: 'audio' }],
      prompt_doc: { version: 1, segments: [segment] },
    }, null, deps);
    expect(result.code).toBe(400); expect(result.data?.code).toBe(error); expect(createJob).not.toHaveBeenCalled();
  });
  it('未连入当前目标的 text_ref 拒绝', async () => {
    const { deps, createJob } = buildAudioTargetDeps(TARGET_CANVAS);
    const result = await handleCreateGenerationJob('u1', 'p1', { ...AUDIO_TARGET_BODY,
      prompt_doc: { version: 1, segments: [{ kind: 'text_ref', node_id: 'text-b' }] },
    }, null, deps);
    expect(result.code).toBe(400); expect(result.data?.code).toBe('invalid_reference'); expect(createJob).not.toHaveBeenCalled();
  });
 });

// ADR-0086：视频普通参考的分类上限——图数按能力行 max_reference_images 校验（此前只查图/视频总数 12，
// 改分类上限后图数一度无人管；本用例锁住图上限与文案）。
describe('handleCreateGenerationJob 视频参考分类上限（ADR-0086）', () => {
  const videoDepsWithFeatures = (features: Record<string, unknown>) => {
    const createJob = vi.fn().mockResolvedValue({ generation_job_id: '1', cursor: 1 });
    const deps = {
      projects: { findOwnedById: vi.fn().mockResolvedValue({ id: '1', name: '项目', thumb: null, created_at: '2026-08-18T00:00:00.000Z' }) },
      models: {
        listEnabledByType: vi.fn().mockResolvedValue([
          {
            model_id: 'doubao-seedance-2-0-260128',
            supported_aspect_ratios: ['16:9', '9:16', '1:1', 'adaptive'],
            features: {
              reference_image: true,
              max_reference_images: 10,
              quantity_max: 1,
              video_reference: false,
              video_reference_max: 3,
              audio_reference: false,
              audio_reference_max: 3,
              image_reference_max: 1,
              max_reference_duration_sec: null,
              ...features,
            },
          },
        ]),
      },
      command: { createJob },
      assets: { resolveInputAssets: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, type: 'image' }))) },
    } as unknown as HandlerDeps;
    return { deps, createJob };
  };

  const imageRef = (i: number) => ({ role: 'reference' as const, asset_id: String(i), type: 'image' as const });

  it('视频普通参考图片数超能力行 max_reference_images → 400 参考图最多 N 张', async () => {
    const { deps, createJob } = videoDepsWithFeatures({ max_reference_images: 3 });
    const result = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: [1, 2, 3, 4].map(imageRef),
    }, null, deps);
    expect(result.code).toBe(400);
    expect(result.msg).toContain('参考图最多 3 张');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('恰好达到图上限（3 张）放行', async () => {
    const { deps } = videoDepsWithFeatures({ max_reference_images: 3 });
    const result = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: [1, 2, 3].map(imageRef),
    }, null, deps);
    expect(result.code).toBe(200);
  });

  it('普通参考含视频素材但模型 video_reference=false → 400 不支持视频素材参考', async () => {
    const { deps, createJob } = videoDepsWithFeatures({});
    const result = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: [{ role: 'reference', asset_id: '9', type: 'video' }],
    }, null, deps);
    expect(result.code).toBe(400);
    expect(result.msg).toContain('当前模型不支持视频素材参考');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('参考素材总时长超能力行上限 → 400（capacity 行 max_reference_duration_sec=15，两条 10s 视频共 20s）', async () => {
    const { deps, createJob } = videoDepsWithFeatures({
      max_reference_duration_sec: 15,
      video_reference: true,
      video_reference_max: 3,
    });
    const result = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: [
        { role: 'reference', asset_id: '9', type: 'video', duration: 10 },
        { role: 'reference', asset_id: '10', type: 'video', duration: 10 },
      ],
    }, null, deps);
    expect(result.code).toBe(400);
    expect(result.msg).toContain('参考素材总时长超过 15 秒');
    expect(createJob).not.toHaveBeenCalled();
  });
});
