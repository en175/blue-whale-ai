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
    // IKG6EK：references 的归属/类型复核现在无条件执行（原先只在携带 prompt_doc 时跑）
    vi.mocked(deps.assets.resolveInputAssets).mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, type: "audio" as const })));

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
    // IKG6EK：references 的归属/类型复核现在无条件执行（原先只在携带 prompt_doc 时跑）
    vi.mocked(deps.assets.resolveInputAssets).mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, type: "image" as const })));

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
    // IKG6EK：references 的归属/类型复核现在无条件执行（原先只在携带 prompt_doc 时跑）
    vi.mocked(deps.assets.resolveInputAssets).mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, type: "audio" as const })));

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

// IKG6EK / ADR-0088：图片端也认单数组 references（三端统一），旧字段 input_asset_ids 保留兼容。
describe("handleCreateGenerationJob 图片参考素材单数组 references（IKG6EK）", () => {
  const refsOf = (ids: string[]) =>
    ids.map((id) => ({ role: "reference" as const, asset_id: id, type: "image" as const }));

  it("references 提供参考 → input_asset_ids 按 references 顺序冻结", async () => {
    const { deps, createJob } = buildImageDeps(10);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...imageBody(0), references: refsOf(["3", "1"]) },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.input_asset_ids).toEqual(["3", "1"]);
  });

  it("references 含 material_id（合法素材库形态）→ 400 素材库引用仅支持视频生成", async () => {
    const { deps, createJob } = buildImageDeps(10);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...imageBody(0),
        references: [{ role: "reference", material_id: "asset-img-1", type: "image" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("素材库引用仅支持视频生成");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 形态非法 → 400 参考素材引用无效（不再静默当空处理）", async () => {
    const { deps, createJob } = buildImageDeps(10);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...imageBody(0), references: [{ role: "reference", type: "image" }] },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 超能力上限 → 400，文案含真实上限", async () => {
    const { deps, createJob } = buildImageDeps(2);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...imageBody(0), references: refsOf(["1", "2", "3"]) },
      null,
      deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考图最多 2 张");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("旧字段 input_asset_ids 仍可用（回归）", async () => {
    const { deps, createJob } = buildImageDeps(10);

    const result = await handleCreateGenerationJob("u1", "p1", imageBody(2), null, deps);

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.input_asset_ids).toEqual([1, 2]);
  });

  it("references: [] 视为未提供 → 回落旧字段 input_asset_ids，不被静默清空", async () => {
    const { deps, createJob } = buildImageDeps(10);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...imageBody(2), references: [] },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.input_asset_ids).toEqual([1, 2]);
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
    // IKG6EK：references 的归属/类型复核现在无条件执行（原先只在携带 prompt_doc 时跑），
    // 本地 asset 的声明类型必须与素材实际类型一致——本用例声明 audio，固按 audio 返回。
    vi.mocked(deps.assets.resolveInputAssets).mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, type: "audio" as const })));
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
    const result = await handleCreateGenerationJob(
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
      },
      null,
      deps,
    );
    // IKG6EK：doc 退役后不再按 doc 声明细化索引文案，视频与图片同口径走通用信封
    expect(result.code).toBe(400);
    expect(result.data?.code).toBe("invalid_reference");
    expect(result.msg).toBe("参考素材不存在或无权访问");
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

/* IKG6EK / ADR-0088：`prompt_doc` 已退役——提交方给正文全文（`parameters.prompt` 一律权威），
   引用标记转移在接纳管线完成（用例见 reference-marker-transfer.test.ts）。
   IKFA1M / IKFA1O / IKFA1P / IKFCJG 四套「doc 权威编译 + 身份复核」用例随契约一并退役。 */

describe("handleCreateGenerationJob prompt_doc 已退役（IKG6EK / ADR-0088）", () => {
  it("图片：携带 prompt_doc 不报错、不生效——正文取 parameters.prompt，input 不冻结该字段", async () => {
    const { deps, createJob } = buildImageDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...imageBody(1),
        prompt_doc: { version: 1, segments: [{ kind: "text", text: "doc 说什么都不算" }] },
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.prompt).toBe("海边日落");
    expect(cmdArg.input).not.toHaveProperty("prompt_doc");
  });

  it("视频：同上", async () => {
    const { deps, createJob } = buildVideoDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "reference", asset_id: "1", type: "image" }],
        prompt_doc: { version: 1, segments: [{ kind: "text", text: "doc 说什么都不算" }] },
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.prompt).toBe("人物走过街角");
    expect(cmdArg.input).not.toHaveProperty("prompt_doc");
  });

  it("doc 结构非法（未知版本 / 未知片段）也不再拦截——字段已惰性化，兼容当前版本前端", async () => {
    const { deps, createJob } = buildImageDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...imageBody(1), prompt_doc: { version: 99, segments: [{ kind: "nope" }] } },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalledTimes(1);
  });
});

// IKG6EK / ADR-0088：正文一律取 parameters.prompt，长度闸也量它（不再有 doc 编译结果）。
it.each([32000, 32001])("正文遵循模型 32000 字边界：%i", async (length) => {
  const { deps, createJob } = buildCapabilityDeps([
    { model_id: "gpt-image-2-text-to-image", features: { max_prompt_length: 32000 } },
  ]);
  const result = await handleCreateGenerationJob("u1", "p1", {
    type: "image", expected_output_count: 1,
    parameters: { prompt: "a".repeat(length), model_id: "gpt-image-2-text-to-image", aspect_ratio: "1:1" },
  }, null, deps);
  expect(result.code).toBe(length === 32000 ? 200 : 400);
  expect(createJob).toHaveBeenCalledTimes(length === 32000 ? 1 : 0);
});

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
