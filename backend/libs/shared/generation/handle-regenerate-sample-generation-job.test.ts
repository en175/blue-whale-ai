import { describe, expect, it, vi } from "vitest";

import {
  deriveSampleRegenerateBody,
  handleRegenerateSampleCreate,
  handleRegenerateSampleQuote,
} from "./handle-regenerate-sample-generation-job.js";
import { handleCreateGenerationJob } from "./handle-create-generation-job.js";
import { projectQuoteInput } from "./handle-create-generation-job.js";
import { quoteRevisionOf } from "./handle-quote-generation-job.js";
import { handleFinalizeGenerationJobQuote } from "./handle-finalize-generation-job.js";
import type { FinalizeSourceJob } from "@lib/shared/persistence/index.js";


const DEADLINE_PAST = BigInt(Date.now() - 1_000);

const SAMPLE_INPUT = {
  provider_credential: "sealed-sample-cred",
  prompt: "人物走过街角",
  model_id: "doubao-seedance-2-5-260628",
  aspect_ratio: "16:9",
  resolution: "480p",
  duration: 5,
  sample_mode: true,
  output_width: 854,
  output_height: 480,
  target_node_id: "node-9",
  text_attachments: [{ node_id: "t1", title: "", text: "补充" }],
  prompt_plan_snapshot: { canvasVersion: 3 },
  text_input_signature: "sig-1",
  placement_anchor: { x: 0, y: 0, width: 320, height: 180 },
  references: [
    { role: "reference", asset_id: "21", type: "image" },
    { role: "reference", asset_id: "31", type: "video", duration: 3 },
  ],
  reference_limits: { video_reference_max: 10 },
  expected_output_count: 1,
};

function sampleJob(overrides: Partial<FinalizeSourceJob> = {}): FinalizeSourceJob {
  return {
    id: "302",
    project_id: "1",
    user_id: "42",
    status: "succeeded",
    type: "video",
    video_stage: "sample",
    final_job_id: null,
    finalize_deadline_ms: BigInt(Date.now() + 24 * 60 * 60 * 1000),
    output_asset_ids: [901n],
    input: SAMPLE_INPUT,
    ...overrides,
  };
}

const S25_CAPABILITY = {
  model_id: "doubao-seedance-2-5-260628",
  version: 77,
  features: {
    sample_mode: true,
    video_reference: true,
    video_reference_max: 10,
    audio_reference: true,
    audio_reference_max: 5,
    image_reference_max: 10,
    max_reference_duration_sec: null,
    video_dimensions: { "resolution=480p|aspect_ratio=16:9": "854x480" },
  },
  supported_sizes: [{ id: "480p", api_value: "480p" }, { id: "1080p", api_value: "1080p" }],
  supported_aspect_ratios: ["16:9"],
  supported_durations: { min: 4, max: 12, step: 4 },
};

function quoteStub(overrides: Partial<{ credits: bigint; catalogVersion: number; tier: string }> = {}) {
  const result = { credits: 19n, catalogVersion: 12, tier: "free", ...overrides };
  return { result, quote: vi.fn().mockResolvedValue(result) };
}

function quotedViewOf(
  sample: FinalizeSourceJob,
  capability: Record<string, unknown>,
  quoteResult: { credits: bigint; catalogVersion: number; tier: string },
): { credits: number; quote_revision: string } {
  const derived = deriveSampleRegenerateBody(sample.input);
  if (derived === null) throw new Error("测试夹具：派生创建请求为空");
  const quoteInput = projectQuoteInput("video", derived, capability as never) as Record<string, unknown> | null;
  if (quoteInput === null) throw new Error("测试夹具：报价投影为空");
  return {
    credits: Number(quoteResult.credits),
    quote_revision: quoteRevisionOf({
      catalogVersion: quoteResult.catalogVersion,
      capabilityVersion: capability.version as number | undefined,
      tier: quoteResult.tier,
      quoteInput,
    }),
  };
}

function confirmationOf(
  sample: FinalizeSourceJob,
  capability: Record<string, unknown>,
  quoteResult: { credits: bigint; catalogVersion: number; tier: string },
): { expected_credits: number; quote_revision: string } {
  const view = quotedViewOf(sample, capability, quoteResult);
  return { expected_credits: view.credits, quote_revision: view.quote_revision };
}

type CreateDeps = Parameters<typeof handleCreateGenerationJob>[4];

function buildDeps(args: {
  sample?: FinalizeSourceJob | null;
  capability?: Record<string, unknown> | null;
  quote?: unknown;
  createResult?: unknown;
  replay?: unknown;
  createDepsOverrides?: Partial<CreateDeps>;
} = {}) {
  const findFinalizeSourceJob = vi.fn().mockResolvedValue(
    args.sample === undefined ? sampleJob() : args.sample,
  );
  const createJob = vi.fn().mockResolvedValue(args.createResult ?? { generation_job_id: "311", cursor: 9 });
  const lookupCreateIdempotency = vi.fn().mockResolvedValue(args.replay ?? null);
  const capability =
    args.capability === null ? [] :
    args.capability === undefined ? [S25_CAPABILITY] : [args.capability];
  const create: CreateDeps = {
    projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "1" }) },
    models: { listEnabledByType: vi.fn().mockResolvedValue(capability) },
    command: { createJob, lookupCreateIdempotency },
    canvas: { getByProject: vi.fn() },
    assets: {
      resolveInputAssets: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          type: id === "31" ? "video" : "image",
          duration: id === "31" ? 3 : null,
          material_id: null,
        }))),
    },
    billing: {
      hold: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    },
    ...(args.quote !== undefined ? { quote: args.quote } : {}),
    ...args.createDepsOverrides,
  } as unknown as CreateDeps;
  const deps = {
    projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "1" }) },
    models: create.models,
    sampleSource: { findFinalizeSourceJob },
    ...(args.quote !== undefined ? { quote: args.quote } : {}),
    create,
  } as never;
  return { deps, findFinalizeSourceJob, createJob, lookupCreateIdempotency, create };
}

describe("deriveSampleRegenerateBody（IKIZQF）", () => {
  it("★ G10: 派生创建请求 = 480p 样片形态；references（含时长）原样；旧快照专属键剥除", () => {
    const body = deriveSampleRegenerateBody(SAMPLE_INPUT)!;

    expect(body.type).toBe("video");
    expect(body.expected_output_count).toBe(1);
    expect(body.parameters).toMatchObject({
      prompt: "人物走过街角",
      aspect_ratio: "16:9",
      model_id: "doubao-seedance-2-5-260628",
      resolution: "480p",
      duration: 5,
      sample_mode: true,
    });
    expect(body.references).toEqual(SAMPLE_INPUT.references);
    expect(body.finalize_deadline_at).toBeUndefined();
    expect(body.finalize_deadline_ms).toBeUndefined();
    expect(body.provider_task_id).toBeUndefined();
    expect(body.provider_credential).toBeUndefined();
    expect(body.target_node_id).toBeUndefined();
    expect(body.text_attachments).toBeUndefined();
    expect(body.prompt_plan_snapshot).toBeUndefined();
    expect(body.text_input_signature).toBeUndefined();
    expect(body.placement_anchor).toBeUndefined();
    expect(body.reference_limits).toBeUndefined();
    expect(body.output_width).toBeUndefined();
    expect(body.output_height).toBeUndefined();
  });

  it("量不出 model_id/prompt/aspect_ratio → null（调用方按不可提交处置）", () => {
    expect(deriveSampleRegenerateBody({ prompt: "x" })).toBeNull();
    expect(deriveSampleRegenerateBody({ model_id: "m", aspect_ratio: "16:9" })).toBeNull();
  });
});

describe("handleRegenerateSampleQuote（IKIZQF）", () => {
  it("★ 前置满足 → 整数积分与 quote_revision（与提交复算同源，不继承旧报价）", async () => {
    const { result, quote } = quoteStub();
    const { deps } = buildDeps({ quote });

    const res = await handleRegenerateSampleQuote("42", "1", "302", {}, deps);

    expect(res.code).toBe(200);
    expect(res.data).toEqual(quotedViewOf(sampleJob(), S25_CAPABILITY as never, result));
    const call = quote.mock.calls[0]![0];
    expect(call.input.resolution).toBe("480p");
    expect(call.input.provider_credential).toBeUndefined();
  });

  it.each([
    ["过期样片", { finalize_deadline_ms: DEADLINE_PAST }],
    ["成片失败占位（final_job_id 非空）", { final_job_id: "305" }],
    ["未成功样片（processing）", { status: "processing" }],
  ])("★ %s → 仍可重新生成报价（过期/失败只封 finalize 入口，不封重新生成）", async (_label, overrides) => {
    const { quote } = quoteStub();
    const { deps } = buildDeps({ sample: sampleJob(overrides as never), quote });

    const res = await handleRegenerateSampleQuote("42", "1", "302", {}, deps);

    expect(res.code).toBe(200);
    expect(res.data).toEqual(quotedViewOf(sampleJob(overrides as never), S25_CAPABILITY as never, quoteStub().result));
  });

  it("★ 对照：同一样片过期后 finalize 报价 → 空报价（1058 只封转成片，接缝证明）", async () => {
    const { quote } = quoteStub();
    const finalizeDeps = {
      projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "1" }) },
      models: { listEnabledByType: vi.fn().mockResolvedValue([S25_CAPABILITY]) },
      command: { findFinalizeSourceJob: vi.fn().mockResolvedValue(sampleJob({ finalize_deadline_ms: DEADLINE_PAST })) },
      quote,
    } as never;

    const res = await handleFinalizeGenerationJobQuote("42", "1", "302", {}, finalizeDeps);

    expect(res.data).toEqual({ credits: null, quote_revision: null });
  });

  it.each([
    ["非样片任务（video_stage=video）", { video_stage: "video" }],
    ["成片任务（video_stage=final）", { video_stage: "final" }],
    ["模型已停用", null as never],
    ["未放行样片模式", { model_id: "doubao-seedance-2-5-260628", features: {} }],
  ])("%s → 空报价双 null", async (_label, capabilityOrOverrides) => {
    const args =
      capabilityOrOverrides === null
        ? { capability: null, quote: quoteStub().quote }
        : typeof capabilityOrOverrides === "object" && "model_id" in (capabilityOrOverrides as Record<string, unknown>)
          ? { capability: capabilityOrOverrides, quote: quoteStub().quote }
          : { sample: sampleJob(capabilityOrOverrides as never), quote: quoteStub().quote };
    const { deps } = buildDeps(args as never);

    const res = await handleRegenerateSampleQuote("42", "1", "302", {}, deps);

    expect(res.code).toBe(200);
    expect(res.data).toEqual({ credits: null, quote_revision: null });
  });

  it("未接报价依赖 / 算不出价 → 空报价；请求体非空对象 → 400；任务或项目不存在 → 404", async () => {
    const noDep = buildDeps({});
    expect((await handleRegenerateSampleQuote("42", "1", "302", {}, noDep.deps)).data)
      .toEqual({ credits: null, quote_revision: null });

    const unpriceable = buildDeps({ quote: vi.fn().mockResolvedValue(null) });
    expect((await handleRegenerateSampleQuote("42", "1", "302", {}, unpriceable.deps)).data)
      .toEqual({ credits: null, quote_revision: null });

    const badBody = buildDeps({ quote: quoteStub().quote });
    expect((await handleRegenerateSampleQuote("42", "1", "302", { prompt: "改写" }, badBody.deps)).code)
      .toBe(1002);

    const missing = buildDeps({ sample: null });
    expect((await handleRegenerateSampleQuote("42", "1", "302", {}, missing.deps)).code).toBe(100301);
  });
});

describe("handleRegenerateSampleCreate（IKIZQF）", () => {
  const happyBody = (sample: FinalizeSourceJob = sampleJob()) =>
    confirmationOf(sample, S25_CAPABILITY as never, quoteStub().result);

  it("★ G10: 过期样片 → 重新生成成功：新任务 video_stage='sample'、冻结 sample_mode、预扣成对装配", async () => {
    const { quote } = quoteStub();
    const { deps, createJob } = buildDeps({
      sample: sampleJob({ finalize_deadline_ms: DEADLINE_PAST }),
      quote,
    });

    const res = await handleRegenerateSampleCreate(
      "42", "1", "302", happyBody(), "key-1", deps,
    );

    expect(res.code).toBe(200);
    expect(res.data).toEqual({ generation_job_id: "311", cursor: 9 });
    const [cmdInput, options] = createJob.mock.calls[0]!;
    expect(cmdInput).toMatchObject({
      projectId: "1",
      userId: "42",
      type: "video",
      expectedOutputCount: 1,
      videoStage: "sample",
    });
    expect(cmdInput.input.sample_mode).toBe(true);
    expect(cmdInput.input.resolution).toBe("480p");
    expect(cmdInput.input.provider_credential).toBeUndefined();
    expect(options.billing).toBeDefined();
    expect(options.billing.hold).toBeTypeOf("function");
    expect(options.billing.release).toBeTypeOf("function");
    expect(cmdInput.input.references).toEqual(SAMPLE_INPUT.references);
  });

  it("★ 成片失败入口：final_job_id 占位（失败成片保留）→ 仍可重新生成新样片", async () => {
    const { quote } = quoteStub();
    const { deps, createJob } = buildDeps({
      sample: sampleJob({ final_job_id: "305" }),
      quote,
    });

    const res = await handleRegenerateSampleCreate("42", "1", "302", happyBody(), "key-1", deps);

    expect(res.code).toBe(200);
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob.mock.calls[0]![0].videoStage).toBe("sample");
  });

  it("★ 幂等：重复请求（同 Key）→ 创建管线重放首次结果，只建一次新任务", async () => {
    const { quote } = quoteStub();
    const { deps, createJob } = buildDeps({
      quote,
      replay: { generation_job_id: "311", cursor: 9 },
    });

    const res = await handleRegenerateSampleCreate("42", "1", "302", happyBody(), "key-1", deps);

    expect(res.code).toBe(200);
    expect(res.data).toEqual({ generation_job_id: "311", cursor: 9 });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ 幂等冲突（同键异载荷）→ 409 信封", async () => {
    const { quote } = quoteStub();
    const { deps } = buildDeps({ quote, replay: { kind: "idempotency_conflict" } });

    const res = await handleRegenerateSampleCreate("42", "1", "302", happyBody(), "key-1", deps);

    expect(res.code).toBe(100409);
  });

  it("★ G03/G04: 确认失败（变价 / revision 失效）→ 1056，零创建零扣费（无需释放——从未预扣）", async () => {
    const bumped = buildDeps({ quote: quoteStub({ credits: 99n }).quote });
    expect(
      (await handleRegenerateSampleCreate("42", "1", "302", happyBody(), "k", bumped.deps)).code,
    ).toBe(1056);
    expect(bumped.createJob).not.toHaveBeenCalled();

    const staleCap = { ...S25_CAPABILITY, version: 999 };
    const stale = buildDeps({ capability: staleCap, quote: quoteStub().quote });
    expect(
      (await handleRegenerateSampleCreate("42", "1", "302", happyBody(), "k", stale.deps)).code,
    ).toBe(1056);
    expect(stale.createJob).not.toHaveBeenCalled();
  });

  it("★ 素材状态重校验：参考素材已不可用 → 400（按当前素材状态，不沿用旧接纳结果）", async () => {
    const { quote } = quoteStub();
    const { deps, createJob } = buildDeps({
      quote,
      createDepsOverrides: {
        assets: {
          resolveInputAssets: vi.fn().mockResolvedValue([]),
        } as never,
      },
    });

    const res = await handleRegenerateSampleCreate("42", "1", "302", happyBody(), "k", deps);

    expect(res.code).toBe(1034);
    expect(res.msg).toBe("参考素材不存在或无权访问");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ strict：额外字段（prompt/references/draft_task_id…）→ 400，零创建", async () => {
    for (const extra of [
      { prompt: "改成雨天" },
      { references: [] },
      { duration: 5 },
      { draft_task_id: "task-private-1" },
    ]) {
      const { deps, createJob } = buildDeps({ quote: quoteStub().quote });
      const res = await handleRegenerateSampleCreate(
        "42", "1", "302", { ...happyBody(), ...extra }, "k", deps,
      );
      expect(res.code, `额外字段 ${JSON.stringify(extra)} 须拒绝`).toBe(1002);
      expect(createJob).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["普通视频任务", { video_stage: "video" }],
    ["成片任务", { video_stage: "final" }],
  ])("★ 前置不满足（%s）→ 明确拒绝，零创建", async (_label, overrides) => {
    const { deps, createJob } = buildDeps({
      sample: sampleJob(overrides as never),
      quote: quoteStub().quote,
    });

    const res = await handleRegenerateSampleCreate("42", "1", "302", happyBody(), "k", deps);

    expect(res.code).toBe(1002);
    expect(res.msg).toBe("仅样片任务可重新生成样片");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ 旧任务只读：重新生成全程不对旧样片行做任何写（sampleSource 只有读投影）", async () => {
    const { quote } = quoteStub();
    const { deps, findFinalizeSourceJob, createJob } = buildDeps({ quote });

    await handleRegenerateSampleCreate("42", "1", "302", happyBody(), "k", deps);

    expect(findFinalizeSourceJob).toHaveBeenCalledTimes(1);
    const cmdInput = createJob.mock.calls[0]![0];
    expect(JSON.stringify(cmdInput)).not.toContain('"302"');
    expect(JSON.stringify(cmdInput)).not.toContain("finalize_deadline");
  });

  it("项目/样片不存在 → 404（不泄露存在性）", async () => {
    const missing = buildDeps({ sample: null, quote: quoteStub().quote });
    expect(
      (await handleRegenerateSampleCreate("42", "1", "302", happyBody(), "k", missing.deps)).code,
    ).toBe(100301);
  });
});

describe("handleRegenerateSampleCreate canvas_binding（IKJJR0）", () => {
  const SUBMISSION = "0a1b2c3d-0000-4000-8000-000000000021";
  const NEW_TARGET = "video-node-regen-1";

  function regenBinding(targetNode = NEW_TARGET, revision = 0) {
    return {
      protocol_version: 1,
      submission_id: SUBMISSION,
      target_node_id: targetNode,
      expected_binding_revision: revision,
      recovery_seed: {
        target: { role: "result-placeholder", x: 0, y: 0, width: 320, height: 180, name: "新样片" },
        sources: [],
      },
    };
  }

  const BINDING_VIEW = {
    protocol_version: 1,
    submission_id: SUBMISSION,
    target_node_id: NEW_TARGET,
    binding_revision: 1,
    job_id: "311",
    is_current: true,
  };

  function buildRegenDeps(args: {
    quote?: unknown;
    replay?: unknown;
    createResult?: unknown;
  } = {}) {
    const createJob = vi.fn().mockResolvedValue(args.createResult ?? { generation_job_id: "311", cursor: 9 });
    const lookupCreateIdempotency = vi.fn().mockResolvedValue(args.replay ?? null);
    const canvasBindingView = vi.fn().mockResolvedValue(BINDING_VIEW);
    const create: CreateDeps = {
      projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "1" }) },
      models: { listEnabledByType: vi.fn().mockResolvedValue([S25_CAPABILITY]) },
      command: { createJob, lookupCreateIdempotency, canvasBindingView },
      canvas: { getByProject: vi.fn() },
      assets: {
        resolveInputAssets: vi.fn(async (ids: string[]) =>
          ids.map((id) => ({
            id,
            type: id === "31" ? "video" : "image",
            duration: id === "31" ? 3 : null,
            material_id: null,
          }))),
      },
      billing: {
        hold: vi.fn().mockResolvedValue(undefined),
        release: vi.fn().mockResolvedValue(undefined),
      },
      ...(args.quote !== undefined ? { quote: args.quote } : {}),
    } as unknown as CreateDeps;
    const deps = {
      projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "1" }) },
      models: create.models,
      sampleSource: { findFinalizeSourceJob: vi.fn().mockResolvedValue(sampleJob()) },
      ...(args.quote !== undefined ? { quote: args.quote } : {}),
      create,
    } as never;
    return { deps, createJob, lookupCreateIdempotency, canvasBindingView, create };
  }

  it("★ canvas_binding 随确认字段并入派生 body → 创建管线统一关联受理（独立新目标，operation=generation.create）", async () => {
    const { quote } = quoteStub();
    const { deps, createJob } = buildRegenDeps({ quote });
    const body = {
      ...confirmationOf(sampleJob(), S25_CAPABILITY as never, quoteStub().result),
      canvas_binding: regenBinding(),
    };

    const res = await handleRegenerateSampleCreate("42", "1", "302", body, SUBMISSION, deps);

    expect(res.code).toBe(200);
    expect(res.data).toMatchObject({ generation_job_id: "311", cursor: 9, canvas_binding: BINDING_VIEW });
    const [cmdInput, options] = createJob.mock.calls[0]!;
    expect(cmdInput.canvasRecovery).toMatchObject({
      projectId: "1",
      userId: "42",
      operation: "generation.create",
      taskType: "video",
      idempotencyKey: SUBMISSION,
    });
    expect(cmdInput.canvasRecovery.binding.target_node_id).toBe(NEW_TARGET);
    expect(typeof cmdInput.canvasRecovery.requestHash).toBe("string");
    expect(cmdInput.canvasRecovery.requestHash).toHaveLength(64);
    expect(options.billing).toBeDefined();
  });

  it("★ 幂等承载不一致（Idempotency-Key ≠ submission_id）→ 400 invalid_recovery_payload，零创建", async () => {
    const { quote } = quoteStub();
    const { deps, createJob } = buildRegenDeps({ quote });
    const body = {
      ...confirmationOf(sampleJob(), S25_CAPABILITY as never, quoteStub().result),
      canvas_binding: regenBinding(),
    };

    const res = await handleRegenerateSampleCreate("42", "1", "302", body, "another-key", deps);

    expect(res).toMatchObject({ code: 400, data: { reason: "invalid_recovery_payload" } });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ canvas_binding 载荷非法 → 400 invalid_recovery_payload（B.8 信封）", async () => {
    const { deps, createJob } = buildRegenDeps({});
    const body = {
      ...confirmationOf(sampleJob(), S25_CAPABILITY as never, quoteStub().result),
      canvas_binding: { protocol_version: 2, submission_id: "not-uuid" },
    };

    const res = await handleRegenerateSampleCreate("42", "1", "302", body, SUBMISSION, deps);

    expect(res).toMatchObject({ code: 400, data: { reason: "invalid_recovery_payload" } });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("★ 报价变化后的已受理重放：同 submission_id 重放原关联，不复算报价、不重复建任务、不预扣（AC3/AC6）", async () => {
    const staleQuote = quoteStub();
    const { deps, createJob, lookupCreateIdempotency } = buildRegenDeps({
      quote: quoteStub({ credits: 99n }).quote,
      replay: { generation_job_id: "311", cursor: 9 },
    });
    const body = {
      ...confirmationOf(sampleJob(), S25_CAPABILITY as never, staleQuote.result),
      canvas_binding: regenBinding(),
    };

    const res = await handleRegenerateSampleCreate("42", "1", "302", body, SUBMISSION, deps);

    expect(res.code).toBe(200);
    expect(res.data).toMatchObject({ generation_job_id: "311", cursor: 9, canvas_binding: BINDING_VIEW });
    expect(lookupCreateIdempotency).toHaveBeenCalledTimes(1);
    expect(createJob).not.toHaveBeenCalled();
    const billing = (deps as { create: { billing?: { hold: ReturnType<typeof vi.fn> } } }).create.billing;
    expect(billing?.hold).not.toHaveBeenCalled();
  });

  it("★ 携旧承接版本抢占已归属节点 → 受理冲突信封（409）直返，不覆盖旧成片承接（AC4）", async () => {
    const conflictEnvelope = {
      code: 409,
      msg: "目标节点承接版本已变化，请刷新后重试",
      data: { reason: "canvas_binding_conflict", currentBindingRevision: 1 },
    };
    const createJob = vi.fn().mockRejectedValue(
      new (await import("@lib/shared/persistence/index.js")).RecoveryContractError(conflictEnvelope as never),
    );
    const { quote } = quoteStub();
    const deps = {
      projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "1" }) },
      models: { listEnabledByType: vi.fn().mockResolvedValue([S25_CAPABILITY]) },
      sampleSource: { findFinalizeSourceJob: vi.fn().mockResolvedValue(sampleJob()) },
      quote,
      create: {
        projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "1" }) },
        models: { listEnabledByType: vi.fn().mockResolvedValue([S25_CAPABILITY]) },
        command: { createJob, lookupCreateIdempotency: vi.fn().mockResolvedValue(null), canvasBindingView: vi.fn() },
        canvas: { getByProject: vi.fn() },
        assets: {
          resolveInputAssets: vi.fn(async (ids: string[]) =>
            ids.map((id) => ({
              id,
              type: id === "31" ? "video" : "image",
              duration: id === "31" ? 3 : null,
              material_id: null,
            }))),
        },
        billing: { hold: vi.fn(), release: vi.fn() },
        quote,
      },
    } as never;
    const body = {
      ...confirmationOf(sampleJob(), S25_CAPABILITY as never, quoteStub().result),
      canvas_binding: regenBinding("video-node-old-final", 0),
    };

    const res = await handleRegenerateSampleCreate("42", "1", "302", body, SUBMISSION, deps);

    expect(res).toEqual(conflictEnvelope);
    expect(createJob).toHaveBeenCalledTimes(1);
  });
});
