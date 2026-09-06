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
        reference_materials: [{ id: "Asset-img-1", type: "audio" }],
      },
      null,
      deps,
    );
    expect(result.code).toBe(400);
    expect(result.msg).toBe("参考素材库引用无效");
    expect(createJob).not.toHaveBeenCalled();
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
  } as unknown as HandlerDeps;
  return { deps, createJob, getByProject };
}

const TARGET_CANVAS = {
  nodes: JSON.stringify([
    { id: "media-1", type: "mediaNode", data: { mediaType: "image" } },
    { id: "media-2", type: "mediaNode", data: { mediaType: "video" } },
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

  it("视频类型携带 target_node_id → 400 仅图片生成可用，不读画布不建任务", async () => {
    const { deps, createJob, getByProject } = buildTargetDeps(TARGET_CANVAS);
    const listEnabledVideo = vi
      .fn()
      .mockResolvedValue([{ model_id: "doubao-seedance-2-0-260128" }]);
    (deps as { models: { listEnabledByType: unknown } }).models.listEnabledByType =
      listEnabledVideo;

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...VIDEO_BODY, target_node_id: "media-1" }, null, deps,
    );

    expect(result.code).toBe(400);
    expect(result.msg).toBe("target_node_id 仅支持图片生成");
    expect(getByProject).not.toHaveBeenCalled();
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
