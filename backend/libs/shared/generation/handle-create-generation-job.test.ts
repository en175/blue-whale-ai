import { describe, expect, it, vi } from "vitest";

import { ERROR_MODEL_UNAVAILABLE, TASK_TYPE_PARAM_CONSTRAINT_MESSAGE } from "@lib/contracts";

import {
  generationCreateRequestHash,
  handleCreateGenerationJob,
  projectQuoteInput,
} from "./handle-create-generation-job.js";
import { quoteRevisionOf, videoQuoteRevisionInput } from "./handle-quote-generation-job.js";





type HandlerDeps = Parameters<typeof handleCreateGenerationJob>[4];



function idempotencyLookup(result: unknown = null) {
  return vi.fn().mockResolvedValue(result);
}

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
    command: { createJob, lookupCreateIdempotency: idempotencyLookup() },
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
    expect(createJob.mock.calls.at(-1)?.[0]).toMatchObject(
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

    expect(result.code).toBe(1002);
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

    expect(result.code).toBe(1002);
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

    expect(result.code).toBe(1004);
    expect(result.msg).toBe("音频生成暂不支持旧参考字段，请使用 references");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 + 音频参考（references type:audio）→ 200，job.input 冻结 references", async () => {
    const { deps, createJob } = buildDeps();

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
    expect(createJob.mock.calls.at(-1)?.[0]).toMatchObject(
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
    expect(createJob.mock.calls.at(-1)?.[0]).toMatchObject(
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

    expect(result.code).toBe(1004);
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

    expect(result.code).toBe(1034);
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

    expect(result.code).toBe(1034);
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

    expect(result.code).toBe(1034);
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

    expect(result.code).toBe(1034);
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

    expect(result.code).toBe(1034);
    expect(result.msg).toBe("参考图最多 1 个");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频 + references + 空旧字段 input_asset_ids:[] → 200（空数组不误判为旧字段，IKE4GC）", async () => {
    const { deps, createJob } = buildDeps();

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

    expect(result.code).toBe(1005);
    expect(result.msg).toBe("model_id 不在可用模型白名单或已停用");
    expect(createJob).not.toHaveBeenCalled();
  });
});



function buildImageDeps(imageReferenceMax?: number) {
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
        imageReferenceMax === undefined
          ? undefined
          : { image_reference_max: imageReferenceMax },
    },
  ]);
  const createJob = vi.fn().mockResolvedValue({
    generation_job_id: "1",
    cursor: 1,
  });


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
    command: { createJob, lookupCreateIdempotency: idempotencyLookup() },
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
    expect(createJob.mock.calls.at(-1)?.[0]).toMatchObject(
      expect.objectContaining({
        type: "image",
        input: expect.objectContaining({
          input_asset_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        }),
      }),
    );

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

    expect(result.code).toBe(1004);
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

    expect(result.code).toBe(1004);
    expect(result.msg).toBe("参考图最多 3 张");
    expect(createJob).not.toHaveBeenCalled();
  });



  it("能力未配置 → 回退图片/视频缺省 10：10 张通过、11 张 400", async () => {
    const { deps: okDeps, createJob: okCreate } = buildImageDeps();
    const ok = await handleCreateGenerationJob(
      "u1",
      "p1",
      imageBody(10),
      null,
      okDeps,
    );
    expect(ok.code).toBe(200);
    expect(okCreate.mock.calls.at(-1)?.[0]).toMatchObject(
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
    expect(fail.code).toBe(1004);
    expect(fail.msg).toBe("参考图最多 10 张");
    expect(failCreate).not.toHaveBeenCalled();
  });
});


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

    expect(result.code).toBe(1004);
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

    expect(result.code).toBe(1034);
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

    expect(result.code).toBe(1004);
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

  it("references 内重复素材 → 去重保首见（与旧字段 uniqueAssetIds 同口径）", async () => {
    const { deps, createJob } = buildImageDeps(10);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...imageBody(0), references: refsOf(["3", "1", "3"]) },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.input_asset_ids).toEqual(["3", "1"]);
  });
});



describe("handleCreateGenerationJob 同次画布读取（IKG6EK）", () => {
  it("目标路径：文本索引派生与目标快照复用同一次读取，画布只读一次", async () => {
    const { deps, createJob, getByProject } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob("u1", "p1", IMAGE_TARGET_BODY, null, deps);

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(getByProject).toHaveBeenCalledTimes(1);
  });
});



describe("handleCreateGenerationJob 引用标记转移（IKG6EK / ADR-0088）", () => {
  it("视频：素材库身份（material_id 提交）→ 正文 &asset-x& 出 @图片1", async () => {
    const { deps, createJob } = buildVideoDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        parameters: { ...VIDEO_BODY.parameters, prompt: "角色参考&asset-active-1& 出场" },
        references: [{ role: "reference", material_id: "asset-active-1", type: "image" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };

    expect(cmdArg.input.prompt).toBe("角色参考@图片1 出场");
  });

  it("视频：首帧按角色、普通参考按同类型编号", async () => {
    const { deps, createJob } = buildVideoDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        parameters: { ...VIDEO_BODY.parameters, prompt: "&11&转场到&12&" },
        references: [
          { role: "first_frame", asset_id: "11", type: "image" },
          { role: "reference", asset_id: "12", type: "image" },
        ],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.prompt).toBe("@首帧转场到@图片1");
  });

  it("未提交的身份不转，原样保留（不猜、不删、不报错）", async () => {
    const { deps, createJob } = buildVideoDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        parameters: { ...VIDEO_BODY.parameters, prompt: "参考&99999999& 和 &12&" },
        references: [{ role: "reference", asset_id: "12", type: "image" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.prompt).toBe("参考&99999999& 和 @图片1");
  });
});


function buildVideoDeps(modelRow: Record<string, unknown> = {}, quote?: unknown) {
  const findOwnedById = vi.fn().mockResolvedValue({
    id: "1",
    name: "项目",
    thumb: null,
    created_at: "2026-08-18T00:00:00.000Z",
  });


  const listEnabledByType = vi.fn().mockResolvedValue([
    { model_id: "doubao-seedance-2-0-260128", ...modelRow },
  ]);
  const createJob = vi.fn().mockResolvedValue({
    generation_job_id: "1",
    cursor: 1,
  });
  const deps = {
    projects: { findOwnedById },
    models: { listEnabledByType },
    command: { createJob, lookupCreateIdempotency: idempotencyLookup() },

    assets: { resolveInputAssets: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, type: "image" }))) },

    ...(quote !== undefined ? { quote } : {}),
  } as unknown as HandlerDeps;
  return { deps, createJob };
}

const VIDEO_BODY = {
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
    expect(result.code).toBe(1004);
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
    expect(result.code).toBe(1002);
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
    expect(result.code).toBe(1034);
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
    expect(result.code).toBe(1034);
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
    expect(result.code).toBe(1002);
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
    expect(result.code).toBe(1002);
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



  it("素材库参考超能力行上限（image_reference_max=12）→ 400 参考图最多 12 张", async () => {
    const { deps, createJob } = buildVideoDeps({
      features: { image_reference_max: 12 },
    });
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
    expect(result.code).toBe(1034);
    expect(result.msg).toBe("参考图最多 12 张");
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
    expect(result.code).toBe(1035);
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
    expect(result.code).toBe(1002);
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
    expect(createJob.mock.calls.at(-1)?.[0]).toMatchObject(
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
    expect(result.code).toBe(1034);
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
    expect(result.code).toBe(1034);
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
    expect(result.code).toBe(1034);
    expect(result.msg).toBe("参考素材引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });




  describe("输出像素按能力行冻结（video_dimensions）", () => {
    const DIMENSIONS = {
      "resolution=720p|aspect_ratio=16:9": "1280x720",
      "resolution=720p|aspect_ratio=adaptive": "1280x720",
    };

    it("配了像素表 → job.input 冻出 output_width / output_height", async () => {
      const { deps, createJob } = buildVideoDeps({ features: { video_dimensions: DIMENSIONS } });
      const result = await handleCreateGenerationJob("u1", "p1", VIDEO_BODY, null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.output_width).toBe(1280);
      expect(cmdArg.input.output_height).toBe(720);
    });

    it("adaptiver 比例走显式键（配了就有）", async () => {
      const { deps, createJob } = buildVideoDeps({ features: { video_dimensions: DIMENSIONS } });
      const result = await handleCreateGenerationJob(
        "u1",
        "p1",
        { ...VIDEO_BODY, parameters: { ...VIDEO_BODY.parameters, aspect_ratio: "adaptive" } },
        null,
        deps,
      );
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.output_width).toBe(1280);
    });

    it("能力行没配像素表 → **不写**这两个键（不写 0）", async () => {
      const { deps, createJob } = buildVideoDeps();
      const result = await handleCreateGenerationJob("u1", "p1", VIDEO_BODY, null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input).not.toHaveProperty("output_width");
      expect(cmdArg.input).not.toHaveProperty("output_height");
    });

    it("配了表但这一格没配 → 也不写（billing 回落目录那份）", async () => {
      const { deps, createJob } = buildVideoDeps({ features: { video_dimensions: DIMENSIONS } });
      const result = await handleCreateGenerationJob(
        "u1",
        "p1",
        { ...VIDEO_BODY, parameters: { ...VIDEO_BODY.parameters, aspect_ratio: "9:16" } },
        null,
        deps,
      );
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input).not.toHaveProperty("output_width");
    });
  });










  describe("首帧/首尾帧比例按能力行判定（不写死）", () => {
    const FRAME_REF = [{ role: "first_frame", asset_id: "11", type: "image" }];
    const FRAME_BODY = (aspect: string) => ({
      ...VIDEO_BODY,
      references: FRAME_REF,
      parameters: { ...VIDEO_BODY.parameters, aspect_ratio: aspect },
    });

    it("能力行锁了 adaptive（2.5 形态）+ 16:9 → 登记码 1002，文案带可用值", async () => {
      const { deps, createJob } = buildVideoDeps({
        supported_aspect_ratios: ["16:9", "adaptive"],
        features: { task_types: { first_frame: { allowed_ratios: ["adaptive"] } } },
      });
      const result = await handleCreateGenerationJob("u1", "p1", FRAME_BODY("16:9"), null, deps);
      expect(result.code).toBe(1002);
      expect(result.msg).toBe("当前模式（first_frame）不支持 比例 16:9，可用：adaptive");
      expect(createJob).not.toHaveBeenCalled();
    });

    it("同一能力行 + adaptive → 200", async () => {
      const { deps } = buildVideoDeps({
        supported_aspect_ratios: ["16:9", "adaptive"],
        features: { task_types: { first_frame: { allowed_ratios: ["adaptive"] } } },
      });
      const result = await handleCreateGenerationJob("u1", "p1", FRAME_BODY("adaptive"), null, deps);
      expect(result.code).toBe(200);
    });

    it("能力行**没有** task_types（2.0 形态）+ 16:9 → 200（修复前这里会被硬规则拒掉）", async () => {
      const { deps } = buildVideoDeps({ supported_aspect_ratios: ["16:9", "adaptive"] });
      const result = await handleCreateGenerationJob("u1", "p1", FRAME_BODY("16:9"), null, deps);
      expect(result.code).toBe(200);
    });

    it("首尾帧两帧查的是 first_last_frame 那一格，不是 first_frame", async () => {
      const { deps, createJob } = buildVideoDeps({
        supported_aspect_ratios: ["16:9", "adaptive"],
        features: {

          task_types: { first_last_frame: { allowed_ratios: ["adaptive"] } },
        },
      });
      const both = await handleCreateGenerationJob(
        "u1",
        "p1",
        {
          ...VIDEO_BODY,
          references: [
            { role: "first_frame", asset_id: "11", type: "image" },
            { role: "last_frame", asset_id: "12", type: "image" },
          ],
          parameters: { ...VIDEO_BODY.parameters, aspect_ratio: "16:9" },
        },
        null,
        deps,
      );
      expect(both.code).toBe(1002);
      expect(both.msg).toContain("first_last_frame");
      expect(createJob).not.toHaveBeenCalled();

      const single = await handleCreateGenerationJob("u1", "p1", FRAME_BODY("16:9"), null, deps);
      expect(single.code).toBe(200);
    });

    it("未指定比例由 validateCommon 拦（本闸不重复兜底，故不写不可达分支）", async () => {
      const { deps, createJob } = buildVideoDeps({
        supported_aspect_ratios: ["16:9", "adaptive"],
        features: { task_types: { first_frame: { allowed_ratios: ["adaptive"] } } },
      });
      const body = FRAME_BODY("16:9");
      const result = await handleCreateGenerationJob(
        "u1",
        "p1",
        { ...body, parameters: { ...body.parameters, aspect_ratio: undefined } },
        null,
        deps,
      );
      expect(result.code).toBe(1002);
      expect(result.msg).toBe("aspect_ratio 无效");
      expect(createJob).not.toHaveBeenCalled();
    });
  });





  describe("任务类型冻结与结构化拒单（IKJ795）", () => {
    const SEEDANCE_2_5_ROW = {
      supported_sizes: [{ id: "720p", api_value: "720p" }],
      supported_aspect_ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
      supported_durations: { min: 4, max: 30, step: 1 },
      features: {
        video_reference: true,
        task_types: {
          text2video: {},
          omni: {},
          image_reference: {},
          first_frame: {},
          first_last_frame: {},
          edit: { allowed_ratios: ["adaptive"], allowed_durations: [-1] },
          extend: { allowed_ratios: ["adaptive"] },
        },
      },
    };
    const VIDEO_REF = [{ role: "reference" as const, material_id: "Asset-vid-1", type: "video" as const }];
    const bodyOf = (prompt: string, aspect: string, duration: number = VIDEO_BODY.parameters.duration) => ({
      ...VIDEO_BODY,
      references: VIDEO_REF,
      parameters: { ...VIDEO_BODY.parameters, prompt, aspect_ratio: aspect, duration },
    });

    it.each([-1, 4, 10, 30])("IKLUVP 显式延长时长 %s 被接纳并原样冻结", async (duration) => {
      const { deps, createJob } = buildVideoDeps({
        ...SEEDANCE_2_5_ROW,
        features: {
          ...SEEDANCE_2_5_ROW.features,
          task_types: {
            ...SEEDANCE_2_5_ROW.features.task_types,
            extend: { allowed_ratios: ["adaptive"], allow_auto_duration: true },
          },
        },
      });
      const body = bodyOf("延长这段视频", "adaptive", duration);
      const result = await handleCreateGenerationJob("u1", "p1", {
        ...body,
        parameters: { ...body.parameters, mode: "extend" },
      }, null, deps);
      expect(result.code).toBe(200);
      expect(createJob.mock.calls[0]?.[0]).toMatchObject({
        input: { video_mode: "extend", duration, aspect_ratio: "adaptive" },
      });
    });

    it("编辑 + 9:16 → 4xx task_type_param_constraint + 用户向文案，不建任务（不扣费）", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("把背景替换成海边", "9:16"), null, deps);
      expect(result.code).toBe(1060);
      expect(result.data?.code).toBe("task_type_param_constraint");
      expect(result.msg).toBe(TASK_TYPE_PARAM_CONSTRAINT_MESSAGE);

      expect(result.msg).not.toContain("edit");
      expect(result.msg).not.toContain("adaptive");
      expect(createJob).not.toHaveBeenCalled();
    });

    it("延长 + 固定比例（16:9）→ 同码 4xx", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("向后延长这个视频", "16:9"), null, deps);
      expect(result.code).toBe(1060);
      expect(result.data?.code).toBe("task_type_param_constraint");
      expect(createJob).not.toHaveBeenCalled();
    });

    it("编辑 + adaptive → 200，快照携带任务类型 edit", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("把背景替换成海边", "adaptive", -1), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_mode).toBe("edit");
    });

    it("显式 mode=edit 但参考里没有视频 → 1002，不建任务（前端同口径禁用发送）", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob(
        "u1",
        "p1",
        {
          ...VIDEO_BODY,
          references: [{ role: "reference", type: "image", material_id: "Asset-img-1" }],
          parameters: {
            ...VIDEO_BODY.parameters,
            prompt: "把背景替换成海边",
            aspect_ratio: "adaptive",
            duration: -1,
            mode: "edit",
          },
        },
        null,
        deps,
      );
      expect(result.code).toBe(1002);
      expect(result.msg).toBe("视频编辑模式至少需要 1 段参考视频");
      expect(createJob).not.toHaveBeenCalled();
    });

    it("纯参考 + 9:16 → 放行且快照携带任务类型 default", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("参考它的运镜风格", "9:16"), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_mode).toBe("omni");
    });

    it("否定句（禁止修改）+ 9:16 → 放行（IKJ78C 否定防护在接纳链路整体成立）", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("禁止修改人物形象", "9:16"), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_mode).toBe("omni");
    });

    it("无任务类型视频（旧 body 无参考）→ 200，快照仍携带 default", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", VIDEO_BODY, null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_mode).toBe("text2video");
    });

    it("2.0 形态（无 task_types）+ 编辑句 + 9:16 → 放行（不把 2.5 的约束套到 2.0）", async () => {
      const { deps } = buildVideoDeps({
        supported_sizes: [{ id: "720p", api_value: "720p" }],
        supported_aspect_ratios: ["16:9", "9:16"],
      });
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("把背景替换成海边", "9:16"), null, deps);
      expect(result.code).toBe(200);
    });

    it("视频不带 resolution/duration（只有比例）→ 编辑 + 9:16 仍被拒（拒单不依赖档位字段）", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob(
        "u1",
        "p1",
        {
          ...VIDEO_BODY,
          references: VIDEO_REF,
          parameters: {
            ...VIDEO_BODY.parameters,
            prompt: "把背景替换成海边",
            aspect_ratio: "9:16",
            resolution: undefined,
            duration: undefined,
          },
        },
        null,
        deps,
      );
      expect(result.code).toBe(1060);
      expect(createJob).not.toHaveBeenCalled();
    });
  });





  describe("视频任务类型判定输入统一（IKJFGQ）", () => {
    const SEEDANCE_2_5_TEXT_REF_ROW = {
      supported_sizes: [{ id: "720p", api_value: "720p" }],
      supported_aspect_ratios: ["16:9", "9:16", "adaptive"],
      supported_durations: { min: 4, max: 30, step: 1 },
      features: {
        video_reference: true,
        task_types: {
          text2video: {},
          omni: {},
          image_reference: {},
          first_frame: {},
          first_last_frame: {},
          edit: { allowed_ratios: ["adaptive"], allowed_durations: [-1] },
          extend: { allowed_ratios: ["adaptive"] },
        },
      },
    };


    const TEXT_REF_CANVAS = {
      nodes: JSON.stringify([
        { id: "media-1", type: "mediaNode", data: { mediaType: "video" } },
        {
          id: "text-a",
          type: "textNode",
          data: {
            text: "参考这段素材",
            mediaMentions: [{ start: 0, end: 2, nodeId: "media-2", assetId: "2" }],
            mediaRefs: [
              { nodeId: "media-2", assetId: "2", mediaType: "video", name: "源视频", url: "http://v/2.mp4" },
            ],
          },
        },
        { id: "media-2", type: "mediaNode", data: { mediaType: "video" } },
      ]),
      edges: JSON.stringify([
        { id: "e-attach", source: "text-a", target: "media-1" },
        { id: "e-index", source: "media-2", target: "text-a", data: { textIndex: true } },
      ]),
    };
    function buildTextRefDeps(duration = 7) {
      const base = buildVideoDeps(SEEDANCE_2_5_TEXT_REF_ROW);
      const deps = {
        ...base.deps,
        canvas: {
          getByProject: vi.fn().mockResolvedValue({
            id: "9",
            project_id: "1",
            version: 3,
            viewport: null,
            nodes: TEXT_REF_CANVAS.nodes,
            edges: TEXT_REF_CANVAS.edges,
          }),
        },

        assets: {
          resolveInputAssets: vi.fn(async (ids: string[]) =>
            ids.map((id) => ({ id, type: "video", duration }))),
        },
      } as unknown as HandlerDeps;
      return { deps, createJob: base.createJob };
    }
    const textRefBodyOf = (prompt: string, aspect: string, duration: number = VIDEO_BODY.parameters.duration) => ({
      ...VIDEO_BODY,
      target_node_id: "media-1",
      parameters: { ...VIDEO_BODY.parameters, prompt, aspect_ratio: aspect, duration },
    });

    it("编辑意图 + 文本带入视频参考 + 9:16 → 1060（统一前判定是 default 会放行，统一后按 edit 拦）", async () => {
      const { deps, createJob } = buildTextRefDeps();
      const result = await handleCreateGenerationJob("u1", "p1", textRefBodyOf("把背景替换成海边", "9:16"), null, deps);
      expect(result.code).toBe(1060);
      expect(result.data?.code).toBe("task_type_param_constraint");
      expect(createJob).not.toHaveBeenCalled();
    });

    it("编辑意图 + 文本带入视频参考 + adaptive → 200，冻结 edit 且计价按源视频时长改写（同一请求两判定一致）", async () => {
      const { deps, createJob } = buildTextRefDeps();
      const result = await handleCreateGenerationJob("u1", "p1", textRefBodyOf("把背景替换成海边", "adaptive", -1), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_mode).toBe("edit");

      expect(cmdArg.input.duration).toBe(-1);
      expect(cmdArg.input.duration_basis_seconds).toBe(7);
    });

    it("编辑意图 + 源时长 7.5 → duration_basis_seconds 四舍五入为 8", async () => {
      const { deps, createJob } = buildTextRefDeps(7.5);
      const result = await handleCreateGenerationJob("u1", "p1", textRefBodyOf("把背景替换成海边", "adaptive", -1), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.duration).toBe(-1);
      expect(cmdArg.input.duration_basis_seconds).toBe(8);
    });

    it("纯参考意图 + 文本带入视频参考 + 9:16 → 200 冻结 default，时长不改写（不误伤参考单）", async () => {
      const { deps, createJob } = buildTextRefDeps();
      const result = await handleCreateGenerationJob("u1", "p1", textRefBodyOf("参考它的运镜风格", "9:16"), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_mode).toBe("omni");
      expect(cmdArg.input.duration).toBe(VIDEO_BODY.parameters.duration);
    });
  });







  describe("图片端预览价与实扣价同构（IKJIVB）", () => {




    const IMAGE_TEXT_REF_CANVAS = {
      nodes: JSON.stringify([
        { id: "media-1", type: "mediaNode", data: { mediaType: "image" } },
        {
          id: "text-a",
          type: "textNode",
          data: {
            text: "参考这张图",
            mediaMentions: [{ start: 0, end: 2, nodeId: "media-2", assetId: "2" }],
            mediaRefs: [
              { nodeId: "media-2", assetId: "2", mediaType: "image", name: "源图", url: "http://v/2.png" },
            ],
          },
        },
        { id: "media-2", type: "mediaNode", data: { mediaType: "image" } },
        { id: "media-4", type: "mediaNode", data: { mediaType: "image" } },
      ]),
      edges: JSON.stringify([
        { id: "e-attach", source: "text-a", target: "media-1" },
        { id: "e-index", source: "media-2", target: "text-a", data: { textIndex: true } },
        { id: "e-direct", source: "media-4", target: "media-1" },
      ]),
    };
    function buildImageTextRefDeps() {
      const base = buildImageDeps(10);
      const deps = {
        ...base.deps,
        canvas: {
          getByProject: vi.fn().mockResolvedValue({
            id: "9",
            project_id: "1",
            version: 3,
            viewport: null,
            nodes: IMAGE_TEXT_REF_CANVAS.nodes,
            edges: IMAGE_TEXT_REF_CANVAS.edges,
          }),
        },
      } as unknown as HandlerDeps;
      return { deps, createJob: base.createJob };
    }

    const imageTextRefBody = (ids: string[]) => ({
      type: "image",
      expected_output_count: 1,
      parameters: { prompt: "海边日落", model_id: "seedream-5.0", aspect_ratio: "1:1" },
      references: ids.map((id) => ({ role: "reference" as const, asset_id: id, type: "image" as const })),
      target_node_id: "media-1",
    });

    it("前端同源提交（references 已含文本带入）→ 冻结原样、报价张数 = 实扣张数", async () => {
      const { deps, createJob } = buildImageTextRefDeps();

      const submitted = imageTextRefBody(["4", "2"]);
      const result = await handleCreateGenerationJob("u1", "p1", submitted, null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };

      expect(cmdArg.input.input_asset_ids).toEqual(["4", "2"]);

      const quote = projectQuoteInput("image", submitted);
      expect((quote?.input_asset_ids as string[]).length).toBe(
        (cmdArg.input.input_asset_ids as string[]).length,
      );
    });

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
    expect(result.code).toBe(1034);
    expect(result.msg).toBe("参考素材引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });


  it("references 普通参考超能力行上限（image_reference_max=12）→ 400 参考图最多 12 张", async () => {
    const { deps, createJob } = buildVideoDeps({
      features: { image_reference_max: 12 },
    });
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
    expect(result.code).toBe(1034);
    expect(result.msg).toBe("参考图最多 12 张");
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
    expect(result.code).toBe(1034);
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
    expect(result.code).toBe(1034);
    expect(result.msg).toBe("参考素材不能为空");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("references 参考音频（type=audio, role=reference）→ 200 冻结进 input 且不占图/视频额度", async () => {
    const { deps, createJob } = buildVideoDeps();


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
    expect(createJob.mock.calls.at(-1)?.[0]).toMatchObject(
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
    expect(result.code).toBe(1034);
    expect(result.msg).toBe("参考素材引用无效");
    expect(createJob).not.toHaveBeenCalled();
  });
});




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
    command: { createJob, lookupCreateIdempotency: idempotencyLookup() },
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

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("目标节点不存在或不是图片媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("目标是 textNode（非 mediaNode）→ 400，不建任务", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...IMAGE_TARGET_BODY, target_node_id: "text-a" }, null, deps,
    );

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("目标节点不存在或不是图片媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("目标是视频 mediaNode → 400，不建任务", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...IMAGE_TARGET_BODY, target_node_id: "media-2" }, null, deps,
    );

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("目标节点不存在或不是图片媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });



  it("正文为空 → 400 prompt 无效，附件不再由服务端补正文", async () => {
    const { deps, createJob } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...IMAGE_TARGET_BODY, parameters: { ...IMAGE_TARGET_BODY.parameters, prompt: "" } },
      null, deps,
    );

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("正文由提交方给全：附件很长也不额外计数，正文本身在上限内 → 200", async () => {
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

    const result = await handleCreateGenerationJob("u1", "p1", IMAGE_TARGET_BODY, null, deps);

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmdArg.input.text_attachments).toHaveLength(2);
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

    expect(result.code).toBe(1002);
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



function buildVideoTargetDeps(
  canvasView: { nodes: string | null; edges: string | null },
  modelRow: Record<string, unknown> = {},
) {
  const { deps, createJob, getByProject } = buildTargetDeps(canvasView);

  (deps as { models: { listEnabledByType: unknown } }).models.listEnabledByType = vi
    .fn()
    .mockResolvedValue([{ model_id: "doubao-seedance-2-0-260128", ...modelRow }]);
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

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("目标节点不存在或不是视频媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("目标节点不存在 → 400，不建任务", async () => {
    const { deps, createJob } = buildVideoTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...VIDEO_TARGET_BODY, target_node_id: "media-404" }, null, deps,
    );

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("目标节点不存在或不是视频媒体节点");
    expect(createJob).not.toHaveBeenCalled();
  });


  it("正文为空 → 400 prompt 无效，附件不再由服务端补正文", async () => {
    const { deps, createJob } = buildVideoTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...VIDEO_TARGET_BODY, parameters: { ...VIDEO_BODY.parameters, prompt: "" } },
      null, deps,
    );

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
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

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("prompt 无效");
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

    expect(result.code).toBe(1002);
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

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });


  it("模型配 2000：正文 2001 字 → 400", async () => {
    const { deps, createJob } = buildAudioTargetDeps(TARGET_CANVAS);
    (deps as { models: { listEnabledByType: unknown } }).models.listEnabledByType = vi
      .fn()
      .mockResolvedValue([{ model_id: "audio-model", features: { max_prompt_length: 2_000 } }]);

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...AUDIO_TARGET_BODY, parameters: { prompt: "a".repeat(2001), model_id: "audio-model" } },
      null, deps,
    );

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("prompt 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("模型配 2000：正文 1999 字 + 画布文本附件 → 200（附件不额外计数）", async () => {
    const { deps, createJob } = buildAudioTargetDeps(TARGET_CANVAS);
    (deps as { models: { listEnabledByType: unknown } }).models.listEnabledByType = vi
      .fn()
      .mockResolvedValue([{ model_id: "audio-model", features: { max_prompt_length: 2_000 } }]);

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...AUDIO_TARGET_BODY, parameters: { prompt: "a".repeat(1999), model_id: "audio-model" } },
      null, deps,
    );

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
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
      parameters: { ...IMAGE_TARGET_BODY.parameters, prompt: "夜景" },
    }, null, deps);
    expect(result.code).toBe(200);
    expect(createJob.mock.calls[0][0].input.text_attachments).toEqual([
      { node_id: "text", title: "", text: "蓝鲸 & 海\n夜景", prompt_source: source },
    ]);
  });
});



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
    command: { createJob, lookupCreateIdempotency: idempotencyLookup() },
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
  channel: "seedream-image",
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
    duration: 10,
  },
};

const AUDIO_CAPABILITY_ROW = {
  model_id: "seed-audio-1.0",
  features: { audio_reference_max: 3, image_reference_max: 1 },
  channel: "new-api",
  pricing: {
    baseUnit: "usage.characters",
    basePrice: { kind: "const", value: 19000 },
    unitDenominator: 100,
    quantityStep: 100,
    rounding: "halfUp",
    minCredits: 1,
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
    expect(result.code).toBe(1031);
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
    expect(result.code).toBe(1032);
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
    expect(result.code).toBe(1033);
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

    const frozen = (createJob.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(frozen.resolution).toBe("4k");
  });



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



const GPT_IMAGE_CAPABILITY = {
  model_id: "gpt-image-1",
  supported_sizes: [{ id: "1k", api_value: "1024x1024" }],
  supported_aspect_ratios: ["1:1", "16:9"],
  supported_durations: null,
  channel: "gpt-image",
  request_mapping: {
    matrix: { "1k": { "1:1": "1024x1024" } },
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
    expect(result.code).toBe(1035);
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
    expect(result.code).toBe(1034);
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
    expect(result.code).toBe(1035);
    expect(result.data?.code).toBe("invalid_reference_type");
    expect(result.msg).toBe("参考素材必须是图片");
    expect(createJob).not.toHaveBeenCalled();
  });
});





describe("handleCreateGenerationJob 素材软删提交拦截（IKG57P）", () => {
  it("纯参考清单（无正文标签）素材软删 → 维持通用文案信封 400 invalid_reference", async () => {
    const { deps, createJob, resolveInputAssets } = buildImageDeps();
    resolveInputAssets.mockResolvedValue([]);
    const result = await handleCreateGenerationJob("u1", "p1", imageBody(1), null, deps);
    expect(result.code).toBe(1034);
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

    expect(result.code).toBe(1034);
    expect(result.data?.code).toBe("invalid_reference");
    expect(result.msg).toBe("参考素材不存在或无权访问");
    expect(createJob).not.toHaveBeenCalled();
  });
});



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

    expect(result.code).toBe(1002);
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

    expect(result.code).toBe(1002);
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

    expect(over.code).toBe(1002);
    expect(exact.code).toBe(200);
  });
});





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


it.each([32000, 32001])("正文遵循模型 32000 字边界：%i", async (length) => {
  const { deps, createJob } = buildCapabilityDeps([
    { model_id: "gpt-image-2-text-to-image", features: { max_prompt_length: 32000 } },
  ]);
  const result = await handleCreateGenerationJob("u1", "p1", {
    type: "image", expected_output_count: 1,
    parameters: { prompt: "a".repeat(length), model_id: "gpt-image-2-text-to-image", aspect_ratio: "1:1" },
  }, null, deps);
  expect(result.code).toBe(length === 32000 ? 200 : 1002);
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

              image_reference_max: 10,
              quantity_max: 1,
              video_reference: false,
              video_reference_max: 3,
              audio_reference: false,
              audio_reference_max: 3,
              max_reference_duration_sec: null,
              ...features,
            },
          },
        ]),
      },
      command: { createJob, lookupCreateIdempotency: idempotencyLookup() },
      assets: { resolveInputAssets: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, type: 'image' }))) },
    } as unknown as HandlerDeps;
    return { deps, createJob };
  };

  const imageRef = (i: number) => ({ role: 'reference' as const, asset_id: String(i), type: 'image' as const });

  it('视频普通参考图片数超能力行 image_reference_max → 400 参考图最多 N 张', async () => {
    const { deps, createJob } = videoDepsWithFeatures({ image_reference_max: 3 });
    const result = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: [1, 2, 3, 4].map(imageRef),
    }, null, deps);
    expect(result.code).toBe(1034);
    expect(result.msg).toContain('参考图最多 3 张');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('恰好达到图上限（3 张）放行', async () => {
    const { deps } = videoDepsWithFeatures({ image_reference_max: 3 });
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
    expect(result.code).toBe(1034);
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
    expect(result.code).toBe(1034);
    expect(result.msg).toContain('参考素材总时长超过 15 秒');
    expect(createJob).not.toHaveBeenCalled();
  });



  it('参考上限按能力行冻结进 job.input.reference_limits', async () => {
    const { deps, createJob } = videoDepsWithFeatures({
      image_reference_max: 14,
      video_reference_max: 5,
      audio_reference_max: 2,
      max_reference_duration_sec: 30,
    });
    const result = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: [imageRef(1)],
    }, null, deps);
    expect(result.code).toBe(200);
    const input = (createJob.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(input.reference_limits).toEqual({
      image_reference_max: 14,
      video_reference_max: 5,
      audio_reference_max: 2,
      max_reference_duration_sec: 30,
    });
  });

  it('同一份 4 张参考图：能力行配 3 时 400、配 5 时 200（上限随配置而非固定常量）', async () => {
    const refs = Array.from({ length: 4 }, (_, i) => imageRef(i + 1));

    const strict = videoDepsWithFeatures({ image_reference_max: 3 });
    const rejected = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: refs,
    }, null, strict.deps);
    expect(rejected.code).toBe(1034);
    expect(rejected.msg).toContain('参考图最多 3 张');
    expect(strict.createJob).not.toHaveBeenCalled();

    const loose = videoDepsWithFeatures({ image_reference_max: 5 });
    const accepted = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: refs,
    }, null, loose.deps);
    expect(accepted.code).toBe(200);
    expect(loose.createJob).toHaveBeenCalledTimes(1);
  });




  it('参考上限完全随能力行走：配 30 收下 13 张参考，配 5 在第 6 张拒绝', async () => {
    const loose = videoDepsWithFeatures({ image_reference_max: 30 });
    const accepted = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: Array.from({ length: 13 }, (_, i) => imageRef(i + 1)),
    }, null, loose.deps);
    expect(accepted.code).toBe(200);
    expect(loose.createJob).toHaveBeenCalledTimes(1);

    const strict = videoDepsWithFeatures({ image_reference_max: 5 });
    const rejected = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      references: Array.from({ length: 6 }, (_, i) => imageRef(i + 1)),
    }, null, strict.deps);
    expect(rejected.code).toBe(1034);
    expect(rejected.msg).toContain('参考图最多 5 张');
    expect(strict.createJob).not.toHaveBeenCalled();
  });
});






describe('handleCreateGenerationJob 模型 id 不再被别名改写（IKHBDO）', () => {
  const videoDepsWithCatalogue = (modelIds: string[]) => {
    const createJob = vi.fn().mockResolvedValue({ generation_job_id: '1', cursor: 1 });
    const deps = {
      projects: { findOwnedById: vi.fn().mockResolvedValue({ id: '1', name: '项目', thumb: null, created_at: '2026-08-18T00:00:00.000Z' }) },
      models: {
        listEnabledByType: vi.fn().mockResolvedValue(
          modelIds.map((model_id) => ({
            model_id,
            supported_aspect_ratios: ['16:9', '9:16', '1:1', 'adaptive'],
            features: {
              reference_image: true,


              image_reference_max: 10,
              quantity_max: 1,
              video_reference: true,
              video_reference_max: 3,
              audio_reference: false,
              audio_reference_max: 3,
              max_reference_duration_sec: null,
            },
          })),
        ),
      },
      command: { createJob, lookupCreateIdempotency: idempotencyLookup() },
      assets: { resolveInputAssets: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, type: 'image' }))) },
    } as unknown as HandlerDeps;
    return { deps, createJob };
  };

  it('旧别名 seedance-2 不在启用目录 → 400 model_unavailable（不再被改写成 2.0 那行）', async () => {


    const { deps, createJob } = videoDepsWithCatalogue(['doubao-seedance-2-0-260128']);

    const result = await handleCreateGenerationJob('u1', 'p1', {
      ...VIDEO_BODY,
      parameters: { ...VIDEO_BODY.parameters, model_id: 'seedance-2' },
    }, null, deps);

    expect(result.code).toBe(1005);
    expect(result.msg).toBe('model_id 不在可用模型白名单或已停用');
    expect(result.data?.code).toBe(ERROR_MODEL_UNAVAILABLE);
    expect(createJob).not.toHaveBeenCalled();
  });
});



describe("handleCreateGenerationJob 计费接线", () => {
  it("charge 与 release 一起交给 repo；release 带上本次 userId 与失败原因", async () => {
    const { deps, createJob } = buildCapabilityDeps([VIDEO_CAPABILITY_ROW]);
    const charge = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    const withBilling = {
      ...deps,
      billing: { charge, release },
    } as unknown as HandlerDeps;

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      VIDEO_PARAMS_OK,
      "key-1",
      withBilling,
    );
    expect(result.code).toBe(200);


    const [jobInput, options] = createJob.mock.calls.at(-1)!;
    expect(jobInput).not.toHaveProperty("billing");
    expect(jobInput).not.toHaveProperty("billingCharge");

    const billing = (options as {
      billing: {
        charge: (jobId: number) => Promise<void>;
        release: (jobId: number, reason: string) => Promise<void>;
      };
    }).billing;
    await billing.charge(501);
    await billing.release(501, "写库失败");

    expect(charge).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", jobId: 501, taskType: "video" }),
    );
    expect(release).toHaveBeenCalledWith({
      userId: "u1",
      jobId: 501,
      reason: "写库失败",
    });
  });

  it("音频 charge 带上本次生效的规则快照（含分档配置）", async () => {
    const { deps, createJob } = buildCapabilityDeps([AUDIO_CAPABILITY_ROW]);
    const charge = vi.fn(async () => {});
    const withBilling = {
      ...deps,
      billing: { charge, release: vi.fn(async () => {}) },
    } as unknown as HandlerDeps;

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      AUDIO_BODY,
      "key-audio",
      withBilling,
    );
    expect(result.code).toBe(200);

    const options = createJob.mock.calls.at(-1)![1] as {
      billing: { charge: (jobId: number) => Promise<void> };
    };
    await options.billing.charge(502);

    const chargeArg = charge.mock.calls[0]![0] as { ruleSnapshot?: string };
    expect(JSON.parse(chargeArg.ruleSnapshot ?? "{}")).toMatchObject({
      baseUnit: "usage.characters",
      unitDenominator: 100,
      quantityStep: 100,
    });
  });
});



describe("handleCreateGenerationJob 幂等（Idempotency-Key）", () => {
  const REPLAY = { generation_job_id: "777", cursor: 42 };

  function buildIdempotentDeps(lookup: unknown) {
    const findOwnedById = vi.fn().mockResolvedValue({
      id: "1",
      name: "项目",
      thumb: null,
      created_at: "2026-08-18T00:00:00.000Z",
    });
    const createJob = vi.fn().mockResolvedValue({
      generation_job_id: "888",
      cursor: 7,
    });
    const lookupCreateIdempotency = idempotencyLookup(lookup);
    const deps = {
      projects: { findOwnedById },
      models: { listEnabledByType: vi.fn().mockResolvedValue([VIDEO_CAPABILITY_ROW]) },
      command: { createJob, lookupCreateIdempotency },
      assets: { resolveInputAssets: vi.fn().mockResolvedValue([]) },
    } as unknown as HandlerDeps;
    return { deps, createJob, lookupCreateIdempotency };
  }

  it("★ 同一 key 命中重放 → 返回首次结果（含 generation_job_id），不再建 job", async () => {
    const { deps, createJob, lookupCreateIdempotency } = buildIdempotentDeps(REPLAY);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      VIDEO_PARAMS_OK,
      "key-1",
      deps,
    );

    expect(result.code).toBe(200);

    expect(result.data).toEqual(REPLAY);
    expect(lookupCreateIdempotency).toHaveBeenCalledWith("p1", {
      key: "key-1",
      requestHash: expect.any(String),
    });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ 重放先于状态校验：模型此刻已不在白名单，命中重放仍返回首次结果", async () => {


    const { deps, createJob } = buildIdempotentDeps(REPLAY);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_PARAMS_OK,
        parameters: { ...VIDEO_PARAMS_OK.parameters, model_id: "早就停用的模型" },
      },
      "key-1",
      deps,
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual(REPLAY);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("同键异载荷 → 100409 冲突，不建 job（同键同载荷才重放）", async () => {
    const { deps, createJob, lookupCreateIdempotency } = buildIdempotentDeps({
      kind: "idempotency_conflict",
    });

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      VIDEO_PARAMS_OK,
      "key-1",
      deps,
    );

    expect(result.code).toBe(100409);
    expect(lookupCreateIdempotency).toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("没带 Idempotency-Key → 完全不接幂等（不查、照常建 job），行为与加幂等表之前一致", async () => {
    const { deps, createJob, lookupCreateIdempotency } = buildIdempotentDeps(REPLAY);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      VIDEO_PARAMS_OK,
      null,
      deps,
    );

    expect(result.code).toBe(200);
    expect(lookupCreateIdempotency).not.toHaveBeenCalled();
    expect(createJob).toHaveBeenCalled();
  });

  it("Idempotency-Key 只发空白 → 与没带同口径，不接幂等", async () => {
    const { deps, createJob, lookupCreateIdempotency } = buildIdempotentDeps(REPLAY);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      VIDEO_PARAMS_OK,
      "   ",
      deps,
    );

    expect(result.code).toBe(200);
    expect(lookupCreateIdempotency).not.toHaveBeenCalled();
    expect(createJob).toHaveBeenCalled();
  });

  it("Idempotency-Key 超过列宽（128）→ 参数登记码（100000），不是拖到落库那一刻以截断/500 收场", async () => {
    const { deps, createJob, lookupCreateIdempotency } = buildIdempotentDeps(REPLAY);

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      VIDEO_PARAMS_OK,
      "k".repeat(129),
      deps,
    );

    expect(result.code).toBe(100000);
    expect(lookupCreateIdempotency).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("摘要只取决于请求语义：键序不同的同一份载荷摘要相同", async () => {
    const body = {
      type: "video",
      expected_output_count: 1,
      parameters: { prompt: "人物走过街角", model_id: "m", aspect_ratio: "16:9" },
    };
    const reordered = {
      parameters: { aspect_ratio: "16:9", model_id: "m", prompt: "人物走过街角" },
      expected_output_count: 1,
      type: "video",
    };

    expect(generationCreateRequestHash("p1", reordered)).toBe(
      generationCreateRequestHash("p1", body),
    );

    expect(
      generationCreateRequestHash("p1", {
        ...body,
        parameters: { ...body.parameters, prompt: "换一句" },
      }),
    ).not.toBe(generationCreateRequestHash("p1", body));

    expect(generationCreateRequestHash("p1", body)).toMatch(/^[0-9a-f]{64}$/);
  });
});



describe("handleCreateGenerationJob 视频参考时长冻结（token 计费）", () => {
  it("本地视频参考：时长取自 assets.duration 并冻结进 input.references", async () => {
    const { deps, createJob } = buildVideoDeps();
    vi.mocked(deps.assets.resolveInputAssets).mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        type: "video",
        url: "https://tos.test/v.mp4",
        mime: "video/mp4",
        size: 100,
        width: 1280,
        height: 720,
        duration: 7.5,
        material_id: null,
      })),
    );

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "reference", asset_id: "12", type: "video" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.references).toEqual([
      { role: "reference", type: "video", asset_id: "12", duration: 7.5 },
    ]);
  });

  it("本地资产引用以资产时长为准，客户端值被覆盖", async () => {
    const { deps, createJob } = buildVideoDeps();
    vi.mocked(deps.assets.resolveInputAssets).mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        type: "video",
        url: "https://tos.test/v.mp4",
        mime: "video/mp4",
        size: 100,
        width: 1280,
        height: 720,
        duration: 99,
        material_id: null,
      })),
    );

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "reference", asset_id: "12", type: "video", duration: 5 }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.references).toEqual([
      { role: "reference", type: "video", asset_id: "12", duration: 99 },
    ]);
  });

  it("资产拿不到时长 → 拒绝提交（不按 0 估，也不放行）", async () => {
    const { deps, createJob } = buildVideoDeps();
    vi.mocked(deps.assets.resolveInputAssets).mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        type: "video",
        url: "https://tos.test/v.mp4",
        mime: "video/mp4",
        size: 100,
        width: 1280,
        height: 720,
        duration: null,
        material_id: null,
      })),
    );

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "reference", asset_id: "12", type: "video" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(100202);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("资产缺时长 → 探测一次、回填资产行并写进冻结引用", async () => {
    const { deps, createJob } = buildVideoDeps();
    const saveMediaInfo = vi.fn().mockResolvedValue(true);
    deps.assets = {
      resolveInputAssets: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          type: "video",
          url: "https://tos.test/v.mp4",
          mime: "video/mp4",
          size: 100,
          width: 1280,
          height: 720,
          duration: null,
          material_id: null,
        })),
      ),
      findStorageKeys: vi.fn().mockResolvedValue(
        new Map([["12", "uploads/u1/video/a.mp4"]]),
      ),
      saveMediaInfo,
    } as never;
    deps.probe = vi.fn().mockResolvedValue({
      sizeBytes: 100,
      durationMs: 7500,
      width: 1280,
      height: 720,
      codec: "h264",
      container: "mp4",
      fps: 30,
    }) as never;

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "reference", asset_id: "12", type: "video" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    expect(deps.probe).toHaveBeenCalledWith("uploads/u1/video/a.mp4");
    expect(saveMediaInfo).toHaveBeenCalledWith(
      "12",
      expect.objectContaining({ durationMs: 7500 }),
    );
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.references).toEqual([
      { role: "reference", type: "video", asset_id: "12", duration: 7.5 },
    ]);
  });

  it("图片参考不写时长（它不进 token 公式的输入时长那一项）", async () => {
    const { deps, createJob } = buildVideoDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "reference", asset_id: "12", type: "image" }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.references).toEqual([
      { role: "reference", type: "image", asset_id: "12" },
    ]);
  });




  it("素材库-only 引用（无本地 asset）：不查本地资产，调用方带的时长原样冻结", async () => {
    const { deps, createJob } = buildVideoDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...VIDEO_BODY,
        references: [{ role: "reference", material_id: "Asset-mat-1", type: "video", duration: 6 }],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    expect(deps.assets.resolveInputAssets).not.toHaveBeenCalled();
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.references).toEqual([
      { role: "reference", type: "video", material_id: "Asset-mat-1", duration: 6 },
    ]);
  });
});





describe("handleCreateGenerationJob 样片门控（IKIZQ7）", () => {
  const SAMPLE_BODY = (parameters: Record<string, unknown> = {}) => ({
    ...VIDEO_BODY,
    parameters: {
      ...VIDEO_BODY.parameters,
      resolution: "480p",
      sample_mode: true,
      ...parameters,
    },
  });

  it("★ 未放行（能力行无 sample_mode 位，默认关闭）→ 400 capability_unsupported_param，不建任务", async () => {
    const { deps, createJob } = buildVideoDeps();

    const result = await handleCreateGenerationJob("u1", "p1", SAMPLE_BODY(), null, deps);

    expect(result.code).toBe(1030);
    expect(result.msg).toBe("当前模型未开放样片模式");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ 放行（features.sample_mode=true）+ 480p → 200，受理为单输出 480p 样片任务", async () => {
    const capability = { model_id: "doubao-seedance-2-0-260128", features: { sample_mode: true } };
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildVideoDeps(capability, quote);

    const body = SAMPLE_BODY();
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, capability, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as {
      type: string;
      expectedOutputCount: number;
      input: Record<string, unknown>;
    };
    expect(cmdArg.type).toBe("video");
    expect(cmdArg.expectedOutputCount).toBe(1);
    expect(cmdArg.input.resolution).toBe("480p");
  });

  it("resolution 非 480p → 400（样片固定 480p，不降级、不静默改写）", async () => {
    const { deps, createJob } = buildVideoDeps({ features: { sample_mode: true } });

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      SAMPLE_BODY({ resolution: "1080p" }),
      null,
      deps,
    );

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("样片模式分辨率必须为 480p");
    expect(createJob).not.toHaveBeenCalled();
  });

  it.each([
    ["字符串 \"true\"", "true"],
    ["null", null],
    ["数字 1", 1],
  ])("sample_mode 非字面 true（%s）→ 400", async (_label, bad) => {
    const { deps, createJob } = buildVideoDeps({ features: { sample_mode: true } });

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      SAMPLE_BODY({ sample_mode: bad }),
      null,
      deps,
    );

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("sample_mode 无效");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("非视频类型携带 sample_mode=true → 400（样片仅视频四模式）", async () => {
    const deps = buildDeps().deps;
    const createJob = (deps as { command: { createJob: ReturnType<typeof vi.fn> } }).command.createJob;

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      {
        ...AUDIO_BODY,
        parameters: { ...AUDIO_BODY.parameters, sample_mode: true },
      },
      null,
      deps,
    );

    expect(result.code).toBe(1004);
    expect(result.msg).toBe("样片模式仅支持视频生成");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ 旧请求兼容：sample_mode=false → 普通视频创建语义（与现有 720p 路径同形）", async () => {
    const { deps, createJob } = buildVideoDeps();

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      SAMPLE_BODY({ sample_mode: false, resolution: "720p" }),
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.resolution).toBe("720p");
  });
});


function sampleQuoteStub(overrides: Partial<{ credits: bigint; catalogVersion: number; tier: string }> = {}) {
  const result = { credits: 19n, catalogVersion: 12, tier: "free", ...overrides };
  return { result, quote: vi.fn().mockResolvedValue(result) };
}



function sampleConfirmationOf(
  body: Record<string, unknown>,
  capability: Record<string, unknown>,
  quoteResult: { credits: bigint; catalogVersion: number; tier: string },
): { expected_credits: number; quote_revision: string } {
  const quoteInput = projectQuoteInput(
    "video",
    body as never,
    capability as never,
  ) as Record<string, unknown> | null;
  if (quoteInput === null) throw new Error("测试夹具：样片报价投影为空");
  return {
    expected_credits: Number(quoteResult.credits),
    quote_revision: quoteRevisionOf({
      catalogVersion: quoteResult.catalogVersion,
      capabilityVersion: capability.version as number | undefined,
      tier: quoteResult.tier,
      quoteInput: videoQuoteRevisionInput(quoteInput),
    }),
  };
}






describe("handleCreateGenerationJob 样片提交确认与阶段落库（IKIZQ8）", () => {
  const SAMPLE_CAPABILITY = { model_id: "doubao-seedance-2-0-260128", features: { sample_mode: true } };

  const SAMPLE_BODY = () => ({
    ...VIDEO_BODY,
    parameters: { ...VIDEO_BODY.parameters, resolution: "480p", sample_mode: true },
  });

  it("★ G03：确认字段齐全且复算一致 → 200；input 冻结 sample_mode、video_stage='sample' 落库", async () => {
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildVideoDeps(SAMPLE_CAPABILITY, quote);

    const body = SAMPLE_BODY();
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, SAMPLE_CAPABILITY, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as {
      input: Record<string, unknown>;
      videoStage?: string;
    };

    expect(cmdArg.input.sample_mode).toBe(true);

    expect(cmdArg.videoStage).toBe("sample");
  });

  it("★ G03：缺 expected_credits / quote_revision → 400，不建任务、不预扣", async () => {
    const { quote } = sampleQuoteStub();
    const { deps, createJob } = buildVideoDeps(SAMPLE_CAPABILITY, quote);

    const result = await handleCreateGenerationJob("u1", "p1", SAMPLE_BODY(), null, deps);

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("样片提交须携带 expected_credits 与 quote_revision");
    expect(createJob).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
  });

  it.each([
    ["expected_credits=0", { expected_credits: 0 }],
    ["expected_credits 为负", { expected_credits: -1 }],
    ["expected_credits 非整数", { expected_credits: 19.5 }],
    ["quote_revision 为空串", { quote_revision: "" }],
  ])("★ G03：确认字段非法（%s）→ 400", async (_label, bad) => {
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildVideoDeps(SAMPLE_CAPABILITY, quote);

    const body = SAMPLE_BODY();
    const confirmation = { ...sampleConfirmationOf(body, SAMPLE_CAPABILITY, quoteResult), ...bad };
    const result = await handleCreateGenerationJob("u1", "p1", { ...body, ...confirmation }, null, deps);

    expect(result.code).toBe(1002);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ G04：报价变动（credits 不一致）→ 1056 quote_stale，零创建、零扣费", async () => {

    const { quote } = sampleQuoteStub({ credits: 21n });
    const staleCapability = { ...SAMPLE_CAPABILITY, version: 345 };
    const { deps, createJob } = buildVideoDeps(staleCapability, quote);

    const body = SAMPLE_BODY();

    const staleConfirmation = sampleConfirmationOf(body, SAMPLE_CAPABILITY, { credits: 19n, catalogVersion: 12, tier: "free" });
    const result = await handleCreateGenerationJob("u1", "p1", { ...body, ...staleConfirmation }, null, deps);

    expect(result.code).toBe(1056);
    expect(result.msg).toBe("预计消耗已更新，请确认后再发送。");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ G04：quote_revision 失效（能力行版本跳变）→ 1056，零创建", async () => {
    const { result: quoteResult, quote } = sampleQuoteStub();

    const bumpedCapability = { ...SAMPLE_CAPABILITY, version: 345 };
    const { deps, createJob } = buildVideoDeps(bumpedCapability, quote);

    const body = SAMPLE_BODY();
    const staleConfirmation = sampleConfirmationOf(body, SAMPLE_CAPABILITY, quoteResult);
    const result = await handleCreateGenerationJob("u1", "p1", { ...body, ...staleConfirmation }, null, deps);

    expect(result.code).toBe(1056);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ G04：算不出价格（quote=null）→ 1063 报价不可用，零创建（无报价不给出可提交金额）", async () => {
    const quote = vi.fn().mockResolvedValue(null);
    const { deps, createJob } = buildVideoDeps(SAMPLE_CAPABILITY, quote);

    const body = SAMPLE_BODY();
    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...body, expected_credits: 19, quote_revision: "catalog-12:cap-none:tier-free:input-any" },
      null, deps,
    );

    expect(result.code).toBe(1063);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ 未接报价依赖（服务端无 quote 装配）→ 1063 fail closed，普通视频不受影响", async () => {
    const { deps, createJob } = buildVideoDeps(SAMPLE_CAPABILITY);

    const body = SAMPLE_BODY();
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, expected_credits: 19, quote_revision: "r1" }, null, deps,
    );

    expect(result.code).toBe(1063);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ G12 回归：普通视频（未开样片）不读确认字段、不落 video_stage——旧行为零变化", async () => {
    const quote = vi.fn();
    const { deps, createJob } = buildVideoDeps({}, quote);

    const result = await handleCreateGenerationJob("u1", "p1", VIDEO_BODY, null, deps);

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as {
      input: Record<string, unknown>;
      videoStage?: string;
    };
    expect(cmdArg.videoStage).toBeUndefined();
    expect(cmdArg.input.sample_mode).toBeUndefined();
    expect(quote).not.toHaveBeenCalled();
  });
});









describe("handleCreateGenerationJob 样片 × 其余三模式（IKIZQ9）", () => {


  const S25_FEATURES = {
    sample_mode: true,
    image_reference_max: 30,
    video_reference: true,
    video_reference_max: 10,
    audio_reference: true,
    audio_reference_max: 10,
    max_reference_duration_sec: 30,
    task_types: {
      first_frame: { allowed_ratios: ["adaptive"] },
      first_last_frame: { allowed_ratios: ["adaptive"] },
    },
  };
  const S25_CAPABILITY = { features: S25_FEATURES };


  const sampleBodyWith = (
    references: unknown,
    aspectRatio = "adaptive",
    parameters: Record<string, unknown> = {},
  ) => ({
    ...VIDEO_BODY,
    references,
    parameters: {
      ...VIDEO_BODY.parameters,
      resolution: "480p",
      sample_mode: true,
      aspect_ratio: aspectRatio,
      ...parameters,
    },
  });


  const typedAssets = vi.fn(async (ids: string[]) =>
    ids.map((id) => {
      if (id === "31") return { id, type: "video", url: "https://tos.test/ref.mp4", mime: "video/mp4", size: 100, width: 1280, height: 720, duration: 4, material_id: null };
      if (id === "32") return { id, type: "audio", url: "https://tos.test/ref.mp3", mime: "audio/mpeg", size: 100, width: null, height: null, duration: 3, material_id: null };
      return { id, type: "image", url: "https://tos.test/img.png", mime: "image/png", size: 100, width: 1024, height: 1024, duration: null, material_id: null };
    }));

  const buildSampleVideoDeps = (
    modelRow: Record<string, unknown> = S25_CAPABILITY,
    quote?: unknown,
  ) => {
    const built = buildVideoDeps(modelRow, quote);
    vi.mocked(built.deps.assets.resolveInputAssets).mockImplementation(typedAssets);
    return built;
  };

  it("★ I 图生首帧样片：references 首帧 + adaptive → 200，受理为 sample 且 references 原样冻结", async () => {
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildSampleVideoDeps(S25_CAPABILITY, quote);

    const body = sampleBodyWith([{ role: "first_frame", asset_id: "11", type: "image" }]);
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, S25_CAPABILITY, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as {
      input: Record<string, unknown>;
      videoStage?: string;
    };
    expect(cmdArg.input.sample_mode).toBe(true);
    expect(cmdArg.input.resolution).toBe("480p");
    expect(cmdArg.videoStage).toBe("sample");

    expect(cmdArg.input.references).toEqual([
      { role: "first_frame", asset_id: "11", type: "image" },
    ]);
  });

  it("★ FL 首尾帧样片：两帧 + adaptive → 200，video_stage=sample 且两帧冻结", async () => {
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildSampleVideoDeps(S25_CAPABILITY, quote);

    const body = sampleBodyWith([
      { role: "first_frame", asset_id: "11", type: "image" },
      { role: "last_frame", asset_id: "12", type: "image" },
    ]);
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, S25_CAPABILITY, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as {
      input: Record<string, unknown>;
      videoStage?: string;
    };
    expect(cmdArg.input.sample_mode).toBe(true);
    expect(cmdArg.videoStage).toBe("sample");
    expect(cmdArg.input.references).toEqual([
      { role: "first_frame", asset_id: "11", type: "image" },
      { role: "last_frame", asset_id: "12", type: "image" },
    ]);
  });

  it("★ R2 纯音频参考样片 → 200，音频参考冻结（resolveInputAssets 按类型解析 url/时长）", async () => {
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildSampleVideoDeps(S25_CAPABILITY, quote);

    const body = sampleBodyWith(
      [{ role: "reference", asset_id: "32", type: "audio", duration: 3 }],
      "16:9",
    );
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, S25_CAPABILITY, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as {
      input: Record<string, unknown>;
      videoStage?: string;
    };
    expect(cmdArg.videoStage).toBe("sample");
    expect(cmdArg.input.references).toEqual([
      { role: "reference", asset_id: "32", type: "audio", duration: 3 },
    ]);
  });

  it("★ R4 图+视频+音频混合参考样片 → 200，三类素材冻结原样", async () => {
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildSampleVideoDeps(S25_CAPABILITY, quote);

    const body = sampleBodyWith(
      [
        { role: "reference", asset_id: "21", type: "image" },
        { role: "reference", asset_id: "31", type: "video", duration: 4 },
        { role: "reference", asset_id: "32", type: "audio", duration: 3 },
      ],
      "16:9",
    );
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, S25_CAPABILITY, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as {
      input: Record<string, unknown>;
      videoStage?: string;
    };
    expect(cmdArg.videoStage).toBe("sample");
    expect(cmdArg.input.references).toEqual([
      { role: "reference", asset_id: "21", type: "image" },
      { role: "reference", asset_id: "31", type: "video", duration: 4 },
      { role: "reference", asset_id: "32", type: "audio", duration: 3 },
    ]);
  });

  it("★ 未放行（能力行无 sample_mode 位）+ 首帧 → 400 当前模型未开放样片模式（入口默认关闭对三模式生效）", async () => {
    const { deps, createJob } = buildSampleVideoDeps({
      features: { ...S25_FEATURES, sample_mode: undefined },
    });

    const result = await handleCreateGenerationJob(
      "u1", "p1", sampleBodyWith([{ role: "first_frame", asset_id: "11", type: "image" }]), null, deps,
    );

    expect(result.code).toBe(1030);
    expect(result.msg).toBe("当前模型未开放样片模式");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("样片 + 首帧比例 16:9（2.5 形态锁 adaptive）→ 400 比例闸照常执行", async () => {
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildSampleVideoDeps(S25_CAPABILITY, quote);

    const body = sampleBodyWith([{ role: "first_frame", asset_id: "11", type: "image" }], "16:9");
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, S25_CAPABILITY, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(1002);
    expect(result.msg).toBe("当前模式（first_frame）不支持 比例 16:9，可用：adaptive");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("样片 + 音频参考超能力行上限 → 400 分类上限照常执行（不因样片放宽）", async () => {
    const strict = { features: { ...S25_FEATURES, audio_reference_max: 1 } };
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildSampleVideoDeps(strict, quote);

    const body = sampleBodyWith(
      [
        { role: "reference", asset_id: "32", type: "audio", duration: 3 },
        { role: "reference", asset_id: "33", type: "audio", duration: 3 },
      ],
      "16:9",
    );
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, strict, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(1034);
    expect(result.msg).toContain("参考音频最多 1 个");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("样片 + 视频参考但模型 video_reference=false → 400 类型闸照常执行", async () => {
    const noVideo = { features: { ...S25_FEATURES, video_reference: false } };
    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildSampleVideoDeps(noVideo, quote);

    const body = sampleBodyWith(
      [{ role: "reference", asset_id: "31", type: "video", duration: 4 }],
      "16:9",
    );
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, noVideo, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(1034);
    expect(result.msg).toContain("当前模型不支持视频素材参考");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("样片 + 首帧与普通参考并存（单数组 references 现有语义）→ 200 原样冻结，样片分支不新增拦截", async () => {


    const { result: quoteResult, quote } = sampleQuoteStub();
    const { deps, createJob } = buildSampleVideoDeps(S25_CAPABILITY, quote);

    const refs = [
      { role: "first_frame", asset_id: "11", type: "image" },
      { role: "reference", asset_id: "21", type: "image" },
    ];
    const body = sampleBodyWith(refs);
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, ...sampleConfirmationOf(body, S25_CAPABILITY, quoteResult) }, null, deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as {
      input: Record<string, unknown>;
      videoStage?: string;
    };
    expect(cmdArg.videoStage).toBe("sample");
    expect(cmdArg.input.references).toEqual(refs);
  });

  it("★ 兼容：同一能力行、同样混合 references 的普通模式（无 sample_mode）→ 200 普通语义零变化", async () => {
    const { deps, createJob } = buildSampleVideoDeps(S25_CAPABILITY);

    const result = await handleCreateGenerationJob(
      "u1", "p1",
      {
        ...VIDEO_BODY,
        references: [
          { role: "reference", asset_id: "21", type: "image" },
          { role: "reference", asset_id: "31", type: "video", duration: 4 },
          { role: "reference", asset_id: "32", type: "audio", duration: 3 },
        ],
      },
      null,
      deps,
    );

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as {
      input: Record<string, unknown>;
      videoStage?: string;
    };
    expect(cmdArg.videoStage).toBeUndefined();
    expect(cmdArg.input.sample_mode).toBeUndefined();
    expect(cmdArg.input.resolution).toBe("720p");
  });
});

describe("handleCreateGenerationJob 参考视频提交前物理校验（IKQYED）", () => {
  const FEATURES = {
    video_reference: true,
    video_reference_max: 3,
    audio_reference: true,
    audio_reference_max: 3,
    image_reference_max: 10,
    max_reference_duration_sec: null,
  };

  function bodyWithVideoRef() {
    return {
      ...VIDEO_BODY,
      references: [{ role: "reference", asset_id: "1", type: "video" }],
    };
  }

  function videoAsset(overrides: Record<string, unknown> = {}) {
    return {
      id: "1",
      type: "video",
      url: "https://tos.test/1.mp4",
      mime: "video/mp4",
      size: 1_000_000,
      width: 1280,
      height: 720,
      duration: 5,
      material_id: null,
      ...overrides,
    };
  }

  it("底部输入区参考视频为 WebM → 400 invalid_reference_media，不建任务", async () => {
    const { deps, createJob } = buildVideoDeps({ features: FEATURES });
    vi.mocked(deps.assets.resolveInputAssets).mockResolvedValue([
      videoAsset({ mime: "video/webm" }),
    ]);
    const result = await handleCreateGenerationJob("u1", "p1", bodyWithVideoRef(), null, deps);
    expect(result.code).toBe(1036);
    expect(result.data?.code).toBe("invalid_reference_media");
    expect(result.msg).toBe("参考视频只支持 MP4 或 MOV");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("底部输入区参考视频短于 2 秒 → 400 invalid_reference_media，不建任务", async () => {
    const { deps, createJob } = buildVideoDeps({ features: FEATURES });
    vi.mocked(deps.assets.resolveInputAssets).mockResolvedValue([
      videoAsset({ duration: 1 }),
    ]);
    const result = await handleCreateGenerationJob("u1", "p1", bodyWithVideoRef(), null, deps);
    expect(result.code).toBe(1036);
    expect(result.data?.code).toBe("invalid_reference_media");
    expect(result.msg).toBe("单个参考视频时长不能少于 2 秒");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("底部输入区参考视频总像素超上限 → 400 invalid_reference_media，不建任务", async () => {
    const { deps, createJob } = buildVideoDeps({ features: FEATURES });
    vi.mocked(deps.assets.resolveInputAssets).mockResolvedValue([
      videoAsset({ width: 4096, height: 2160 }),
    ]);
    const result = await handleCreateGenerationJob("u1", "p1", bodyWithVideoRef(), null, deps);
    expect(result.code).toBe(1036);
    expect(result.data?.code).toBe("invalid_reference_media");
    expect(result.msg).toBe("参考视频宽高比或总像素不满足要求");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("合规参考视频 → 200 建任务", async () => {
    const { deps, createJob } = buildVideoDeps({ features: FEATURES });
    vi.mocked(deps.assets.resolveInputAssets).mockResolvedValue([videoAsset()]);
    const result = await handleCreateGenerationJob("u1", "p1", bodyWithVideoRef(), null, deps);
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  it("画布旧字段 reference_asset_ids 提交不合规参考视频 → 400，不建任务", async () => {
    const { deps, createJob } = buildVideoTargetDeps(TARGET_CANVAS, { features: FEATURES });
    vi.mocked(deps.assets.resolveInputAssets).mockResolvedValue([
      videoAsset({ mime: "video/webm" }),
    ]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, target_node_id: "media-2", reference_asset_ids: ["1"] },
      null,
      deps,
    );
    expect(result.code).toBe(1036);
    expect(result.data?.code).toBe("invalid_reference_media");
    expect(result.msg).toBe("参考视频只支持 MP4 或 MOV");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("画布旧字段 reference_asset_ids 提交合规参考视频 → 200 建任务", async () => {
    const { deps, createJob } = buildVideoTargetDeps(TARGET_CANVAS, { features: FEATURES });
    vi.mocked(deps.assets.resolveInputAssets).mockResolvedValue([videoAsset()]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_BODY, target_node_id: "media-2", reference_asset_ids: ["1"] },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });
});

describe("handleCreateGenerationJob 参考图总像素预检（IKQYEH）", () => {
  it("单张参考图超过 3600 万像素 → 400 invalid_reference，不建任务", async () => {
    const { deps, createJob, resolveInputAssets } = buildCapabilityDeps([GPT_IMAGE_CAPABILITY]);
    resolveInputAssets.mockResolvedValue([
      { id: "1", type: "image", url: "https://tos.test/1.png", mime: "image/png", size: 100, width: 8000, height: 5000, duration: null, material_id: null },
    ]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...gptImageBody("1:1"), input_asset_ids: ["1"] },
      null,
      deps,
    );
    expect(result.code).toBe(1034);
    expect(result.data?.code).toBe("invalid_reference");
    expect(result.msg).toBe(
      "参考图总像素超出当前模型限制（单张最多 3600 万像素），请更换较小的图片后重试",
    );
    expect(createJob).not.toHaveBeenCalled();
  });

  it("能力配置覆盖默认上限 → 按 100 万像素拒绝", async () => {
    const { deps, createJob, resolveInputAssets } = buildCapabilityDeps([
      { ...GPT_IMAGE_CAPABILITY, features: { max_reference_image_pixels: 1_000_000 } },
    ]);
    resolveInputAssets.mockResolvedValue([
      { id: "1", type: "image", url: "https://tos.test/1.png", mime: "image/png", size: 100, width: 2000, height: 600, duration: null, material_id: null },
    ]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...gptImageBody("1:1"), input_asset_ids: ["1"] },
      null,
      deps,
    );
    expect(result.code).toBe(1034);
    expect(result.data?.params).toEqual({ max_reference_pixels: 1_000_000 });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("单张参考图恰在 3600 万像素 → 放行", async () => {
    const { deps, createJob, resolveInputAssets } = buildCapabilityDeps([GPT_IMAGE_CAPABILITY]);
    resolveInputAssets.mockResolvedValue([
      { id: "1", type: "image", url: "https://tos.test/1.png", mime: "image/png", size: 100, width: 6000, height: 6000, duration: null, material_id: null },
    ]);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...gptImageBody("1:1"), input_asset_ids: ["1"] },
      null,
      deps,
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });
});



describe("handleCreateGenerationJob 视频/音频参考图上限（IKSLLC）", () => {
  function referenceImageAsset(overrides: Record<string, unknown> = {}) {
    return {
      id: "11",
      type: "image",
      url: "https://tos.test/11.png",
      mime: "image/png",
      size: 100,
      width: 2048,
      height: 2048,
      duration: null,
      material_id: null,
      ...overrides,
    };
  }

  const VIDEO_IMAGE_LIMITS = {
    max_reference_image_pixels: 36_000_000,
    max_reference_image_ratio: 2.5,
  };

  async function createVideoWithImage(
    features: Record<string, unknown>,
    refs: Array<Record<string, unknown>>,
    assets: Array<Record<string, unknown>>,
  ) {
    const { deps, createJob, resolveInputAssets } = buildCapabilityDeps([
      { ...VIDEO_CAPABILITY_ROW, features },
    ]);
    resolveInputAssets.mockResolvedValue(assets);
    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      { ...VIDEO_PARAMS_OK, references: refs },
      null,
      deps,
    );
    return { result, createJob };
  }

  it("首帧 6144×6144 超过 3600 万像素 → 400 invalid_reference，不建任务", async () => {
    const { result, createJob } = await createVideoWithImage(
      VIDEO_IMAGE_LIMITS,
      [{ role: "first_frame", asset_id: "11", type: "image" }],
      [referenceImageAsset({ width: 6144, height: 6144 })],
    );
    expect(result.code).toBe(1034);
    expect(result.data?.code).toBe("invalid_reference");
    expect(result.msg).toBe(
      "参考图总像素超出当前模型限制（单张最多 3600 万像素），请更换较小的图片后重试",
    );
    expect(createJob).not.toHaveBeenCalled();
  });

  it("omni 参考图 7000×5200 超过 3600 万像素 → 400 invalid_reference", async () => {
    const { result, createJob } = await createVideoWithImage(
      VIDEO_IMAGE_LIMITS,
      [{ role: "reference", asset_id: "11", type: "image" }],
      [referenceImageAsset({ width: 7000, height: 5200 })],
    );
    expect(result.code).toBe(1034);
    expect(result.data?.code).toBe("invalid_reference");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("首帧比例超出 2.5 → 400 invalid_reference", async () => {
    const { result, createJob } = await createVideoWithImage(
      VIDEO_IMAGE_LIMITS,
      [{ role: "first_frame", asset_id: "11", type: "image" }],
      [referenceImageAsset({ width: 6400, height: 400 })],
    );
    expect(result.code).toBe(1034);
    expect(result.data?.params).toMatchObject({ max_reference_ratio: 2.5 });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("首帧 2048×2048 正常尺寸 → 200", async () => {
    const { result, createJob } = await createVideoWithImage(
      VIDEO_IMAGE_LIMITS,
      [{ role: "first_frame", asset_id: "11", type: "image" }],
      [referenceImageAsset()],
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  it("能力行未配参考图上限 → 不校验，6144×6144 首帧放行", async () => {
    const { result, createJob } = await createVideoWithImage(
      { first_frame: true },
      [{ role: "first_frame", asset_id: "11", type: "image" }],
      [referenceImageAsset({ width: 6144, height: 6144 })],
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  const AUDIO_IMAGE_LIMITS = {
    image_reference_max: 1,
    audio_reference_max: 3,
    max_reference_image_bytes: 10_485_760,
  };

  async function createAudioWithImage(
    features: Record<string, unknown>,
    asset: Record<string, unknown>,
  ) {
    const { deps, createJob, resolveInputAssets } = buildCapabilityDeps([
      { ...AUDIO_CAPABILITY_ROW, features },
    ]);
    resolveInputAssets.mockResolvedValue([asset]);
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
    return { result, createJob };
  }

  it("音频参考图 gif → 400 invalid_reference_media", async () => {
    const { result, createJob } = await createAudioWithImage(AUDIO_IMAGE_LIMITS, {
      ...referenceImageAsset({ id: "42", mime: "image/gif" }),
    });
    expect(result.code).toBe(1036);
    expect(result.data?.code).toBe("invalid_reference_media");
    expect(result.msg).toBe("参考图仅支持 JPEG、PNG 或 WebP 格式");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频参考图超过 10 MB → 400 invalid_reference_media", async () => {
    const { result, createJob } = await createAudioWithImage(AUDIO_IMAGE_LIMITS, {
      ...referenceImageAsset({ id: "42", size: 10_485_761 }),
    });
    expect(result.code).toBe(1036);
    expect(result.msg).toBe("参考图不能超过 10 MB");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("音频参考图 png 且大小合规 → 200", async () => {
    const { result, createJob } = await createAudioWithImage(AUDIO_IMAGE_LIMITS, {
      ...referenceImageAsset({ id: "42" }),
    });
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });

  it("音频能力行未配图片上限 → 不校验格式与大小", async () => {
    const { result, createJob } = await createAudioWithImage(
      { image_reference_max: 1, audio_reference_max: 3 },
      { ...referenceImageAsset({ id: "42", mime: "image/gif", size: 99_999_999 }) },
    );
    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalled();
  });
});
