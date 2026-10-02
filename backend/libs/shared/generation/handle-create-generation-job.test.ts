import { describe, expect, it, vi } from "vitest";

import { ERROR_MODEL_UNAVAILABLE, TASK_TYPE_PARAM_CONSTRAINT_MESSAGE } from "@lib/contracts";

import {
  generationCreateRequestHash,
  handleCreateGenerationJob,
  projectQuoteInput,
} from "./handle-create-generation-job.js";
import { quoteRevisionOf } from "./handle-quote-generation-job.js";

// IK9ILQ：音频生成接入 —— 校验分支单测。
// 通过公开入口 handleCreateGenerationJob 打私有 validate()（对齐 Java CreateGenerationJobRequest 约束）：
// 音频任务无 aspect_ratio 校验、prompt≤3000、单输出、一期不支持参考素材、model_id 白名单。

type HandlerDeps = Parameters<typeof handleCreateGenerationJob>[4];

/** 建任务幂等查询（command 端口）。缺省「无行」——没带 Idempotency-Key 的用例走的就是
 *  与加幂等表之前完全相同的路径（这个函数根本不会被调用）。 */
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
          // IKHEXG：音频行的图参考上限 1（原夹具同时带 max_reference_images:10 与
          // image_reference_max:1——两键合并后只剩这一个，取音频链路原本生效的 1）。
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

    expect(result.code).toBe(1005);
    expect(result.msg).toBe("model_id 不在可用模型白名单或已停用");
    expect(createJob).not.toHaveBeenCalled();
  });
});

// IKA72G：图片参考图上限读取模型能力配置（features.image_reference_max），
// 不再写死 4；无配置时回退与网关/ARK 一致的 10；字段统一 input_asset_ids。
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

  // IKHEXG：图片/视频链路的缺省仍是 10（网关 maxImageEditImages / 方舟 Seedream 复合编辑），
  // 按行类型选的缺省只在音频链路上是 1（见 model-capability-repo 的两个 DEFAULT_* 常量）。
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

// IKG6EK / ADR-0088：编号表与冻结的文本附件必须来自**同一次**画布读取——
// 两次读会拿到不同版本，与「同次画布读取」的不变式冲突（原 IKFA1J 并发用例随 doc 退役删除，此处补回）。
describe("handleCreateGenerationJob 同次画布读取（IKG6EK）", () => {
  it("目标路径：文本索引派生与目标快照复用同一次读取，画布只读一次", async () => {
    const { deps, createJob, getByProject } = buildTargetDeps(TARGET_CANVAS);

    const result = await handleCreateGenerationJob("u1", "p1", IMAGE_TARGET_BODY, null, deps);

    expect(result.code).toBe(200);
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(getByProject).toHaveBeenCalledTimes(1);
  });
});

// IKG6EK / ADR-0088：引用标记转移的端到端接线——references 的身份 → 编号表 → input.prompt。
// （删掉 reference-marker-transfer.ts 之后，这条链只剩这里能钉住；纯替换由 core 的用例覆盖。）
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
    // 标记里的身份与 references 元素身份同源（asset_id ?? material_id），直接查表，不做互认
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

// 素材库引用（MaterialReference）：仅视频生成；格式校验 + 与本地 Asset 引用按并集互斥/配对。
function buildVideoDeps(modelRow: Record<string, unknown> = {}, quote?: unknown) {
  const findOwnedById = vi.fn().mockResolvedValue({
    id: "1",
    name: "项目",
    thumb: null,
    created_at: "2026-08-18T00:00:00.000Z",
  });
  // IKHBDO：可选 modelRow 覆盖能力行（如 features.image_reference_max）——参考上限只认配置，
  // 用例需要能给出「配到 12 / 配到 30」的行；缺省保持原先的无 features 行。
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
    // IKFA1O：prompt_doc 复核对 references 本地 asset 查存在性与类型——按传入 id 动态返回（默认 image）
    assets: { resolveInputAssets: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, type: "image" }))) },
    // IKIZQ8：样片提交确认的复算依赖——只有样片用例注入。
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

  // IKHBDO：原先此处断言写死的「参考素材最多 12 个」。上限改由能力行判定后，同一条请求的
  // 判词随配置走（12 上限 → 「参考图最多 12 张」），故断言改成配置口径，兼作「能力行生效」的证据。
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

  // 视频输出像素：能力行的像素表按 (resolution, aspect_ratio) 查一次，冻成两个**标量**。
  // 它是 billing 估 token 的输入（经 specs 随 Hold 过去），也是 `video_dimensions` 那条
  // 字段裁决表登记的「配置赢」证明。
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

  // 首帧/首尾帧的比例闸：**按模型读能力行**，不再写死「有首帧就必须 adaptive」。
  //
  // 官方《创建视频生成任务》「不同模型的取值限制和 adaptive 适配规则」：
  //   首帧或首尾帧生视频 · Seedance 2.5     = 默认且仅支持 adaptive
  //   首帧或首尾帧生视频 · Seedance 2.0 系列 = 支持 adaptive 或指定宽高比
  //
  // 所以**同一条请求**（首帧 + 16:9）在一个模型上必须 400、在另一个上必须放行，
  // 而差别**只来自能力行配置**——下面两个用例的能力行只差 `features.task_types` 一项，
  // 代码里没有任何模型名/前缀判断。
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
      expect(result.msg).toBe("当前任务类型（first_frame）不支持 比例 16:9，可用：adaptive");
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
          // 只锁首尾帧；first_frame 未配 → 单帧那条请求应放行
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

  // IKJ795：任务类型冻结进快照 + 编辑/延长比例结构化拒单（task_type_param_constraint）。
  //
  // 能力行是 Seedance 2.5 形态（task_types 配了 edit/prolong 锁 adaptive，default 放开全部比例）；
  // 行为由配置驱动、与模型名无关——与上面首帧组同一口径。
  describe("任务类型冻结与结构化拒单（IKJ795）", () => {
    const SEEDANCE_2_5_ROW = {
      supported_sizes: [{ id: "720p", api_value: "720p" }],
      supported_aspect_ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
      supported_durations: { min: 4, max: 30, step: 1 },
      features: {
        video_reference: true,
        task_types: {
          default: { allowed_ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"] },
          edit: { allowed_ratios: ["adaptive"] },
          prolong: { allowed_ratios: ["adaptive"] },
        },
      },
    };
    const VIDEO_REF = [{ role: "reference" as const, material_id: "Asset-vid-1", type: "video" as const }];
    const bodyOf = (prompt: string, aspect: string) => ({
      ...VIDEO_BODY,
      references: VIDEO_REF,
      parameters: { ...VIDEO_BODY.parameters, prompt, aspect_ratio: aspect },
    });

    it("编辑 + 9:16 → 4xx task_type_param_constraint + 用户向文案，不建任务（不扣费）", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("把背景替换成海边", "9:16"), null, deps);
      expect(result.code).toBe(1060);
      expect(result.data?.code).toBe("task_type_param_constraint");
      expect(result.msg).toBe(TASK_TYPE_PARAM_CONSTRAINT_MESSAGE);
      // 文案不出现内部词（用户直接可见）
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
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("把背景替换成海边", "adaptive"), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_task_type).toBe("edit");
    });

    it("纯参考 + 9:16 → 放行且快照携带任务类型 default", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("参考它的运镜风格", "9:16"), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_task_type).toBe("default");
    });

    it("否定句（禁止修改）+ 9:16 → 放行（IKJ78C 否定防护在接纳链路整体成立）", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", bodyOf("禁止修改人物形象", "9:16"), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_task_type).toBe("default");
    });

    it("无任务类型视频（旧 body 无参考）→ 200，快照仍携带 default", async () => {
      const { deps, createJob } = buildVideoDeps(SEEDANCE_2_5_ROW);
      const result = await handleCreateGenerationJob("u1", "p1", VIDEO_BODY, null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_task_type).toBe("default");
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

  // IKJFGQ：视频任务类型判定输入统一到文本带入合并后的引用集合——冻结值与报价口径
  // （applyEditSourceDurationBasis 对合并后集合现场重判）同请求一致；编辑/延长比例闸对
  // 「视频参考仅来自画布文本带入」的提交同样生效（原先读合并前 body.references 时冻结值是
  // default，比例不拦、计价却按编辑口径改写时长，两处分叉）。
  describe("视频任务类型判定输入统一（IKJFGQ）", () => {
    const SEEDANCE_2_5_TEXT_REF_ROW = {
      supported_sizes: [{ id: "720p", api_value: "720p" }],
      supported_aspect_ratios: ["16:9", "9:16", "adaptive"],
      supported_durations: { min: 4, max: 30, step: 1 },
      features: {
        video_reference: true,
        task_types: {
          default: { allowed_ratios: ["16:9", "9:16", "adaptive"] },
          edit: { allowed_ratios: ["adaptive"] },
          prolong: { allowed_ratios: ["adaptive"] },
        },
      },
    };
    // 画布：目标视频卡 media-1 ← 文本卡 text-a（正文提及 media-2 的视频素材，mediaMentions/
    // mediaRefs 快照齐备）+ 关系线 media-2 → text-a（textIndex 标记）——文本带入参考由此派生。
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
    function buildTextRefDeps() {
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
        // 文本带入的本地 asset（id=2）按声明返回 video + 权威时长 7s（时长冻结与编辑计价都吃它）
        assets: {
          resolveInputAssets: vi.fn(async (ids: string[]) =>
            ids.map((id) => ({ id, type: "video", duration: 7 }))),
        },
      } as unknown as HandlerDeps;
      return { deps, createJob: base.createJob };
    }
    const textRefBodyOf = (prompt: string, aspect: string) => ({
      ...VIDEO_BODY,
      target_node_id: "media-1",
      parameters: { ...VIDEO_BODY.parameters, prompt, aspect_ratio: aspect },
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
      const result = await handleCreateGenerationJob("u1", "p1", textRefBodyOf("把背景替换成海边", "adaptive"), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_task_type).toBe("edit");
      // applyEditSourceDurationBasis 按源视频时长（7s）改写——与冻结值同一请求同口径
      expect(cmdArg.input.duration).toBe(7);
    });

    it("纯参考意图 + 文本带入视频参考 + 9:16 → 200 冻结 default，时长不改写（不误伤参考单）", async () => {
      const { deps, createJob } = buildTextRefDeps();
      const result = await handleCreateGenerationJob("u1", "p1", textRefBodyOf("参考它的运镜风格", "9:16"), null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmdArg.input.video_task_type).toBe("default");
      expect(cmdArg.input.duration).toBe(VIDEO_BODY.parameters.duration);
    });
  });

  // IKJIVB：图片端「预览价 = 实扣价」同构回归。参考图张数是定价维度（Seedream 按张计价），
  // 后端会把画布文本带入的参考追加进实扣集合（body 缺失项追加 input_asset_ids 尾部）；
  // 前端 ImageDialog 的报价 references 与提交 references 在草稿绑定模式共用同一份
  // mergedImageRefsOf 推导（直接参考在前、文本带入追加、同 assetId 去重）——所以两端张数
  // 必须一致。用例 1 复刻产品真实提交形态断言「报价张数 = 实扣冻结张数」；用例 2 是反事实
  // 对照（references 漏带文本带入），证明若前端口径漂移，后端不会替报价兜底——分叉会真实发生。
  describe("图片端预览价与实扣价同构（IKJIVB）", () => {
    // 画布：图片草稿 media-1 ← 文本卡 text-a（正文提及 media-2 的图片素材，mediaMentions/
    // mediaRefs 快照齐备）+ 关系线 media-2 → text-a（textIndex 标记）+ 直接参考 media-4。
    // 前端 mergedImageRefsOf 在等价画布上输出 assetId ["4", "2"]（见 textIndexSync.test.ts
    // 「直接参考在前、文本带入追加」用例），即报价与提交共用的那份数组。
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
    // 与前端 buildImageJobReferences 同形状（role=reference / type=image / asset_id）
    const imageTextRefBody = (ids: string[]) => ({
      type: "image",
      expected_output_count: 1,
      parameters: { prompt: "海边日落", model_id: "seedream-5.0", aspect_ratio: "1:1" },
      references: ids.map((id) => ({ role: "reference" as const, asset_id: id, type: "image" as const })),
      target_node_id: "media-1",
    });

    it("前端同源提交（references 已含文本带入）→ 冻结原样、报价张数 = 实扣张数", async () => {
      const { deps, createJob } = buildImageTextRefDeps();
      // 前端 mergedImageRefsOf 输出：直接参考 ["4"] + 文本带入 ["2"]
      const submitted = imageTextRefBody(["4", "2"]);
      const result = await handleCreateGenerationJob("u1", "p1", submitted, null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
      // body 已含全部画布参考 → 后端权威追加为空，冻结与提交同序同张
      expect(cmdArg.input.input_asset_ids).toEqual(["4", "2"]);
      // 报价投影（同 body 两路）：参考张数一致 —— 「预览价 = 实扣价」的张数前提
      const quote = projectQuoteInput("image", submitted);
      expect((quote?.input_asset_ids as string[]).length).toBe(
        (cmdArg.input.input_asset_ids as string[]).length,
      );
    });

    it("对照组：references 漏带文本带入 → 后端追加实扣参考，报价张数 < 实扣张数（前端口径漂移时无兜底）", async () => {
      const { deps, createJob } = buildImageTextRefDeps();
      // 反事实：模拟「报价/提交只按面板直接参考，未含画布文本提及素材」
      const submitted = imageTextRefBody(["4"]);
      const result = await handleCreateGenerationJob("u1", "p1", submitted, null, deps);
      expect(result.code).toBe(200);
      const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
      // 实扣侧后端权威追加 body 缺失的文本带入项
      expect(cmdArg.input.input_asset_ids).toEqual(["4", "2"]);
      const quote = projectQuoteInput("image", submitted);
      // 报价只按请求携带的 references 数张 → 1 < 2：分叉机制真实存在，唯有前端同源可消除
      expect((quote?.input_asset_ids as string[]).length).toBe(1);
      expect((cmdArg.input.input_asset_ids as string[]).length).toBe(2);
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

  // IKHBDO：同上一「素材库参考」用例——单数组 references 分支的判词同样只认能力行。
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
    // 顺序即 edges 数组顺序；缺 title 缺省 ""；空白正文照实冻结（长度闸只量提交上来的正文，不影响冻结）；
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

  // IKH4B8：长度闸只看提交上来的正文全文——附件正文已由前端拼进 prompt（ADR-0088），
  // 服务端不再二次叠加（原组合闸把它算了两遍）。所以「空 prompt + 长附件」不再是有效请求。
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

// IKDLQG：target_node_id 文本附件扩展到生视频目标（mediaType 为 video 的 mediaNode）。
// 快照形状与图片同构；视频既有冻结字段（resolution/duration/参考引用）保持。
function buildVideoTargetDeps(canvasView: { nodes: string | null; edges: string | null }) {
  const { deps, createJob, getByProject } = buildTargetDeps(canvasView);
  // 白名单按请求里的真实目录 id 校验（旧 seedance-2 别名已删除）
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

  // IKH4B8：视频同口径——正文由提交方给全，空正文即无效请求，附件不额外计数。
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

  // IKH4B8：音频上限同样「模型配置优先」，且只量正文全文（附件不额外计数）。
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
  channel: "gpt-image",
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

// IKG57P：素材软删后提交未被方案级校验拦截——8453e04a 把 freezePromptPlans（planError：
// 规格 7.2 文案 + #N 索引，抛 BadRequestException）挪到通用存在性检查之后，软删素材先命中
// 通用检查的信封 fail 被短路。修复为合并语义：通用检查发现缺失且正文标签引用了缺失素材时，
// 按 planError 同源形态抛规格文案与具体索引；纯参考清单维持通用文案信封（HTTP 投影在 controller）。
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
    // IKG6EK：doc 退役后不再按 doc 声明细化索引文案，视频与图片同口径走通用信封
    expect(result.code).toBe(1034);
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

/* IKG6EK / ADR-0088：`prompt_doc` 已退役——提交方给正文全文（`parameters.prompt` 一律权威），
   引用标记转移在接纳管线完成（用例见本文件「引用标记转移」组）。
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
              // IKHEXG：两键合并后只剩一个图参考上限，取视频链路原本生效的 10。
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

  // IKHBDO：参考上限由接纳侧按能力行冻结进 job.input.reference_limits —— worker 不含模型知识，
  // 执行期只读这份快照（对齐 generate_audio 的冻结口径）。
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

  // IKHBDO：**配置必须赢**。白名单解析前的预检拿不到能力行，绝不能自带一个数量上限——
  // 写死 12 会让「13 张 + 配 30」的模型永久卡死（本用例前半段就是该场景的回归）。
  // 后半段是反向证据：上限确实随配置收紧，不是「一律放行」。
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

// IKHBDO：模型 id **原样取用**，只认运营配置的目录行。
// 这里曾有一张 `VIDEO_MODEL_ALIASES = { "seedance-2": "doubao-seedance-2-0-260128" }` 的旧前端
// 兼容表，在**白名单查询之前**改写 model_id。按「配置永远第一」这是个反例：别名表是写死的，
// 而它抢在配置之前生效——运营若真配一行 model_id 就叫 `seedance-2`，请求会被改写成 2.0 那行，
// 那一行永远赢不了。故删除，改为原样取用：非目录 id 一律以 400 明确失败，而不是被静默改写。
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
              // IKHEXG：视频行的图参考上限 10（原夹具同时带 max_reference_images:10 与
              // image_reference_max:1——两键合并后只剩这一个，取视频链路原本生效的 10）。
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
    // 目录里只有真实型号 `doubao-seedance-2-0-260128`——恰是旧别名表的目标。
    // 若别名改写恢复，`seedance-2` 会被改写成该行从而 200；本用例把它钉成 400。
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

// ★ 计费接线（IK 计费切换）：预扣与补偿必须**成对**下传给 repo —— 少了 release，
//   事务回滚后那笔冻结没人退，就是一笔永远冻着、没有对应任务的预留。
describe("handleCreateGenerationJob 计费接线", () => {
  it("hold 与 release 一起交给 repo；release 带上本次 userId 与失败原因", async () => {
    const { deps, createJob } = buildCapabilityDeps([VIDEO_CAPABILITY_ROW]);
    const hold = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    const withBilling = {
      ...deps,
      billing: { hold, release },
    } as unknown as HandlerDeps;

    const result = await handleCreateGenerationJob(
      "u1",
      "p1",
      VIDEO_PARAMS_OK,
      "key-1",
      withBilling,
    );
    expect(result.code).toBe(200);

    // 计费依赖是**第二个参数**（行为不进数据），不在任务入参上
    const [jobInput, options] = createJob.mock.calls.at(-1)!;
    expect(jobInput).not.toHaveProperty("billing");
    expect(jobInput).not.toHaveProperty("billingHold");

    const billing = (options as {
      billing: {
        hold: (jobId: number) => Promise<void>;
        release: (jobId: number, reason: string) => Promise<void>;
      };
    }).billing;
    await billing.hold(501);
    await billing.release(501, "写库失败");

    expect(hold).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", jobId: 501, taskType: "video" }),
    );
    expect(release).toHaveBeenCalledWith({
      userId: "u1",
      jobId: 501,
      reason: "写库失败",
    });
  });
});

// ★ 建任务幂等（command_idempotency，operation=generation.create）：带 Idempotency-Key 的
//   重复提交返回**第一次的结果**，而不是再建一个 job。
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
    // 响应体就是第一次那次的形状与数值——客户端拿到的 generation_job_id 没变
    expect(result.data).toEqual(REPLAY);
    expect(lookupCreateIdempotency).toHaveBeenCalledWith("p1", {
      key: "key-1",
      requestHash: expect.any(String),
    });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ 重放先于状态校验：模型此刻已不在白名单，命中重放仍返回首次结果", async () => {
    // 「同一个请求被重试」的答案在第一次提交时就定了，不该被此刻的模型目录改写
    // （白名单、素材门、画布快照都在幂等查询**之后**）。
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
    // 载荷真的不同则摘要必须不同（否则「同键异载荷」永远判不出来）
    expect(
      generationCreateRequestHash("p1", {
        ...body,
        parameters: { ...body.parameters, prompt: "换一句" },
      }),
    ).not.toBe(generationCreateRequestHash("p1", body));
    // 定长 64 hex：正好落进 request_hash 的 VarChar(64)
    expect(generationCreateRequestHash("p1", body)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// 视频按 token 计费：含视频输入时官方公式要把**输入时长**算进 token，
// 而时长只能从参考素材上拿 —— 本地素材查 assets.duration，其余靠调用方带。
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

  it("调用方已带的时长不被资产值覆盖（素材库引用只能靠它）", async () => {
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
      { role: "reference", type: "video", asset_id: "12", duration: 5 },
    ]);
  });

  it("资产拿不到时长 → 不写这个字段（宁可让 billing 拒绝，也不按 0 估）", async () => {
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

    expect(result.code).toBe(200);
    const cmdArg = createJob.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmdArg.input.references).toEqual([
      { role: "reference", type: "video", asset_id: "12" },
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

  // IKJIV8：references 全为素材库引用（material_id，本地零表）时共享管线筛选为空——
  // 服务端没做任何回填，不改写 effectiveBody.references（IKJIVA 重构曾以 parsed 副本
  // 覆盖，属行为漂移）。钉住旧语义：零本地资产查询、调用方带的时长原样冻结。
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

// ═══════════════════════════════════════════════════════════════
// IKIZQ7：样片增量门控（fail closed）——能力未放行 / 形态不合契约一律 400 明确拒绝；
// 未传或 false 零影响（普通视频创建语义）。与报价入口共用 ruleSampleMode 一条判定。
// ═══════════════════════════════════════════════════════════════
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

/** IKIZQ8：样片报价桩——返回与报价入口同形的 Quote 结果（credits 为 bigint）。 */
function sampleQuoteStub(overrides: Partial<{ credits: bigint; catalogVersion: number; tier: string }> = {}) {
  const result = { credits: 19n, catalogVersion: 12, tier: "free", ...overrides };
  return { result, quote: vi.fn().mockResolvedValue(result) };
}

/** IKIZQ8：按「报价入口同一套」复算 body 应携带的提交确认两字段。
 *  capability 即夹具注入能力目录的那一行——handler 侧用 whitelist.find 取到同一对象。 */
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
      quoteInput,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// IKIZQ8：样片提交确认 + 阶段落库（契约 §1/§2，金标 G01/G03/G04）。
// 服务端核对 expected_credits 与 quote_revision：变价或无报价 → 1056 quote_stale，
// 零创建、零扣费；接纳后冻结 sample_mode 进 input、video_stage='sample' 落库。
// ═══════════════════════════════════════════════════════════════
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
    // 契约 §1：样片增量冻结进 input 快照（Worker 读它走 Draft/禁 URL 直存降级/算截止）。
    expect(cmdArg.input.sample_mode).toBe(true);
    // 阶段身份落库：G01「服务端把该请求受理为 video_stage=sample 的独立 GenerationJob」。
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
    // 服务端复算得 21，用户提交的还是 19——按未确认金额拒绝。
    const { quote } = sampleQuoteStub({ credits: 21n });
    const staleCapability = { ...SAMPLE_CAPABILITY, version: 345 };
    const { deps, createJob } = buildVideoDeps(staleCapability, quote);

    const body = SAMPLE_BODY();
    // 用户看到的报价来自旧目录（credits=19），提交时目录已变。
    const staleConfirmation = sampleConfirmationOf(body, SAMPLE_CAPABILITY, { credits: 19n, catalogVersion: 12, tier: "free" });
    const result = await handleCreateGenerationJob("u1", "p1", { ...body, ...staleConfirmation }, null, deps);

    expect(result.code).toBe(1056);
    expect(result.msg).toBe("价格已更新，请刷新后重新确认提交");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ G04：quote_revision 失效（能力行版本跳变）→ 1056，零创建", async () => {
    const { result: quoteResult, quote } = sampleQuoteStub();
    // 提交时的能力行 version=345（用户报价时是 undefined/none）——revision 指纹不同。
    const bumpedCapability = { ...SAMPLE_CAPABILITY, version: 345 };
    const { deps, createJob } = buildVideoDeps(bumpedCapability, quote);

    const body = SAMPLE_BODY();
    const staleConfirmation = sampleConfirmationOf(body, SAMPLE_CAPABILITY, quoteResult);
    const result = await handleCreateGenerationJob("u1", "p1", { ...body, ...staleConfirmation }, null, deps);

    expect(result.code).toBe(1056);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ G04：算不出价格（quote=null）→ 1056，零创建（无报价不给出可提交金额）", async () => {
    const quote = vi.fn().mockResolvedValue(null);
    const { deps, createJob } = buildVideoDeps(SAMPLE_CAPABILITY, quote);

    const body = SAMPLE_BODY();
    const result = await handleCreateGenerationJob(
      "u1", "p1",
      { ...body, expected_credits: 19, quote_revision: "catalog-12:cap-none:tier-free:input-any" },
      null, deps,
    );

    expect(result.code).toBe(1056);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ 未接报价依赖（服务端无 quote 装配）→ 1056 fail closed，普通视频不受影响", async () => {
    const { deps, createJob } = buildVideoDeps(SAMPLE_CAPABILITY);

    const body = SAMPLE_BODY();
    const result = await handleCreateGenerationJob(
      "u1", "p1", { ...body, expected_credits: 19, quote_revision: "r1" }, null, deps,
    );

    expect(result.code).toBe(1056);
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

// ═══════════════════════════════════════════════════════════════
// IKIZQ9：样片 × 其余三模式（图生首帧 / 首尾帧 / 全能参考）。
// 机制本身模式无关（ruleSampleMode 只判 video/480p/单输出/能力位；references 的
// role 结构、比例闸与分类上限由 validateVideo 复核对样片请求照常执行）——本组钉
// 的是**组合证据**：三模式样片请求被受理为 video_stage=sample 且 references 原样
// 冻结；各自素材数量/类型限制在样片下同样 fail closed；入口默认关闭对三模式生效；
// 同一能力行的普通模式与既有参考素材规则零变化。不创建第五种视频模式。
// ═══════════════════════════════════════════════════════════════
describe("handleCreateGenerationJob 样片 × 其余三模式（IKIZQ9）", () => {
  /** Seedance 2.5 形态能力行：样片位放行（测试注入，运营目录默认仍关闭）+ 首帧/首尾帧
   *  锁 adaptive + 图/视频/音频参考全开（数量上限对齐官方全能参考边界）。 */
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

  /** 样片化视频 body：480p + sample_mode + 可覆盖比例。 */
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

  /** 按 asset_id 返回对应类型资产（R 组三类素材都能解析出 url 与时长）。 */
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
    // 不创建第五种模式：沿用既有 references 结构，首帧冻结原样（Worker 按同一 role 组装 Draft）。
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
    expect(result.msg).toBe("当前任务类型（first_frame）不支持 比例 16:9，可用：adaptive");
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
    // 现有行为：单数组 references 路径不设「帧 vs 普通参考」互斥（那是旧字段路径的闸）；
    // 样片分支沿用同一语义——本票只做组合扩展，不在样片下收紧或放宽任何参考规则。
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
