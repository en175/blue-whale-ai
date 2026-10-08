import { describe, expect, it, vi } from "vitest";

import {
  deriveFinalizeInput,
  handleFinalizeGenerationJobCreate,
  handleFinalizeGenerationJobQuote,
} from "./handle-finalize-generation-job.js";
import { quoteRevisionOf } from "./handle-quote-generation-job.js";
import type { FinalizeSourceJob } from "@lib/shared/persistence/index.js";

/** IKIZQC：成片报价与提交（契约 §3/§4，金标 G02/G03/G04/G05/G06/G08/G13）。 */

const DEADLINE_FUTURE = BigInt(Date.now() + 24 * 60 * 60 * 1000);
const DEADLINE_PAST = BigInt(Date.now() - 1_000);

/** 样片冻结输入：含参考视频时长（G13——成片计价的输入视频维度）与样片专属键。 */
const SAMPLE_INPUT = {
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
    { role: "reference", asset_id: "32", type: "audio", duration: 3 },
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
    final_job_status: null,
    finalize_deadline_ms: DEADLINE_FUTURE,
    output_asset_ids: [901n],
    input: SAMPLE_INPUT,
    ...overrides,
  };
}

const S25_CAPABILITY = {
  model_id: "doubao-seedance-2-5-260628",
  features: {
    sample_mode: true,
    video_dimensions: { "resolution=1080p|aspect_ratio=16:9": "1920x1080" },
  },
};

function buildDeps(args: {
  sample?: FinalizeSourceJob | null;
  capability?: Record<string, unknown> | null;
  quote?: unknown;
  createResult?: unknown;
  replay?: { generation_job_id: string; cursor: number } | { kind: "idempotency_conflict" } | null;
}) {
  const findFinalizeSourceJob = vi.fn().mockResolvedValue(
    args.sample === undefined ? sampleJob() : args.sample,
  );
  const createFinalizeJob = vi.fn().mockResolvedValue(
    args.createResult ?? { generation_job_id: "305", cursor: 7 },
  );
  const lookupFinalizeIdempotency = vi.fn().mockResolvedValue(args.replay ?? null);
  const deps = {
    projects: { findOwnedById: vi.fn().mockResolvedValue({ id: "1" }) },
    models: {
      listEnabledByType: vi.fn().mockResolvedValue(
        args.capability === null ? [] : args.capability === undefined ? [S25_CAPABILITY] : [args.capability],
      ),
    },
    command: { findFinalizeSourceJob, createFinalizeJob, lookupFinalizeIdempotency },
    ...(args.quote !== undefined ? { quote: args.quote } : {}),
    billing: {
      hold: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    },
  } as never;
  return { deps, findFinalizeSourceJob, createFinalizeJob, lookupFinalizeIdempotency };
}

/** 报价桩：与提交复算同形（credits 为 bigint）。 */
function quoteStub(overrides: Partial<{ credits: bigint; catalogVersion: number; tier: string }> = {}) {
  const result = { credits: 76n, catalogVersion: 12, tier: "free", ...overrides };
  return { result, quote: vi.fn().mockResolvedValue(result) };
}

/** 按「报价入口同一套」复算提交确认两字段。 */
function confirmationOf(
  sample: FinalizeSourceJob,
  capability: Record<string, unknown>,
  quoteResult: { credits: bigint; catalogVersion: number; tier: string },
): { expected_credits: number; quote_revision: string } {
  const derived = deriveFinalizeInput(sample.input, capability as never);
  if (derived === null) throw new Error("测试夹具：派生输入为空");
  return {
    expected_credits: Number(quoteResult.credits),
    quote_revision: quoteRevisionOf({
      catalogVersion: quoteResult.catalogVersion,
      capabilityVersion: capability.version as number | undefined,
      tier: quoteResult.tier,
      quoteInput: derived,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// deriveFinalizeInput（G02/G13）
// ═══════════════════════════════════════════════════════════════
describe("deriveFinalizeInput（IKIZQC）", () => {
  it("★ G02/G13: 同模型 1080p；references（含视频时长）原样保留；样片/画布/凭证键剥除", () => {
    const derived = deriveFinalizeInput(SAMPLE_INPUT, S25_CAPABILITY as never)!;

    expect(derived.model_id).toBe("doubao-seedance-2-5-260628");
    expect(derived.resolution).toBe("1080p");
    expect(derived.expected_output_count).toBe(1);
    // G13：输入视频时长取原样片参考素材（3 秒视频参考原样冻结），样片视频本体不在其中。
    expect(derived.references).toEqual(SAMPLE_INPUT.references);
    expect(derived.reference_limits).toEqual(SAMPLE_INPUT.reference_limits);
    expect(derived.sample_mode).toBeUndefined();
    expect(derived.target_node_id).toBeUndefined();
    expect(derived.text_attachments).toBeUndefined();
    expect(derived.prompt_plan_snapshot).toBeUndefined();
    expect(derived.text_input_signature).toBeUndefined();
    expect(derived.placement_anchor).toBeUndefined();
    // 480p 像素按 1080p 重算。
    expect(derived.output_width).toBe(1920);
    expect(derived.output_height).toBe(1080);
  });

  it("量不出 model_id → null（调用方按不可提交处置）", () => {
    expect(deriveFinalizeInput({ prompt: "x" })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 成片报价（fail open，金标 G06/G08 折空报价）
// ═══════════════════════════════════════════════════════════════
describe("handleFinalizeGenerationJobQuote（IKIZQC）", () => {
  it("★ 前置全满足 → 返回整数积分与 quote_revision（与提交复算同源）", async () => {
    const { result, quote } = quoteStub();
    const { deps } = buildDeps({ quote });

    const res = await handleFinalizeGenerationJobQuote("42", "1", "302", {}, deps);

    expect(res.code).toBe(200);
    expect(res.data).toEqual({ credits: 76, quote_revision: confirmationOf(sampleJob(), S25_CAPABILITY as never, result).quote_revision });
    const call = quote.mock.calls[0]![0];
    expect(call.input.resolution).toBe("1080p");
  });

  it.each([
    ["非样片任务（video_stage=video）", { video_stage: "video" }],
    ["未成功（processing）", { status: "processing" }],
    ["未转存（output_asset_ids 空）", { output_asset_ids: [] }],
    ["已有成片（final_job_id 占位）", { final_job_id: "305" }],
    ["缺可信截止（deadline null）", { finalize_deadline_ms: null }],
    ["已过期（deadline 过去）", { finalize_deadline_ms: DEADLINE_PAST }],
  ])("★ %s → 空报价双 null（样片保留、成片禁用，不报错）", async (_label, overrides) => {
    const { quote } = quoteStub();
    const { deps } = buildDeps({ sample: sampleJob(overrides as never), quote });

    const res = await handleFinalizeGenerationJobQuote("42", "1", "302", {}, deps);

    expect(res.code).toBe(200);
    expect(res.data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("模型已停用/未放行样片模式/算不出价/未接报价依赖 → 空报价", async () => {
    for (const args of [
      { capability: null },
      { capability: { model_id: "doubao-seedance-2-5-260628", features: {} } },
      { quote: vi.fn().mockResolvedValue(null) },
      {},
    ] as const) {
      const { deps } = buildDeps(args as never);
      const res = await handleFinalizeGenerationJobQuote("42", "1", "302", {}, deps);
      expect(res.data).toEqual({ credits: null, quote_revision: null });
    }
  });

  it("报价请求体非空对象 → 400（契约 videoFinalizeQuoteRequestSchema .strict()）", async () => {
    const { deps } = buildDeps({});
    const res = await handleFinalizeGenerationJobQuote("42", "1", "302", { prompt: "改写" }, deps);
    expect(res.code).toBe(1002);
  });

  it("项目/样片不存在或非本人 → 404，不泄露存在性", async () => {
    const missing = buildDeps({ sample: null });
    await expect(
      handleFinalizeGenerationJobQuote("42", "1", "302", {}, missing.deps),
    ).resolves.toMatchObject({ code: 100301 });
  });
});

// ═══════════════════════════════════════════════════════════════
// 成片提交（fail closed，金标 G02/G03/G04/G05/G06/G08）
// ═══════════════════════════════════════════════════════════════
describe("handleFinalizeGenerationJobCreate（IKIZQC）", () => {
  const happyBody = () => confirmationOf(sampleJob(), S25_CAPABILITY as never, quoteStub().result);

  it("★ G02: 请求体带 prompt/references/duration/draft_task_id 等任一额外字段 → 400 拒绝，零创建零扣费", async () => {
    for (const extra of [
      { prompt: "改成雨天" },
      { references: [] },
      { duration: 5 },
      { aspect_ratio: "16:9" },
      { generate_audio: true },
      { draft_task_id: "task-private-1" },
      { source_draft_id: "task-private-1" },
    ]) {
      const { deps, createFinalizeJob } = buildDeps({ quote: quoteStub().quote });
      const res = await handleFinalizeGenerationJobCreate(
        "42", "1", "302", { ...happyBody(), ...extra }, "key-1", deps,
      );
      expect(res.code, `额外字段 ${JSON.stringify(extra)} 须拒绝`).toBe(1002);
      expect(createFinalizeJob).not.toHaveBeenCalled();
    }
  });

  it("★ 缺 Idempotency-Key → 400（契约 §3：本次 Idempotency-Key 必带）", async () => {
    const { deps } = buildDeps({ quote: quoteStub().quote });
    const res = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), null, deps);
    expect(res.code).toBe(100000);
    expect(res.msg).toBe("缺少 Idempotency-Key");
  });

  it("★ 同键重放先于状态校验：样片已过期仍重放首次结果（不被此刻状态改写）", async () => {
    const { deps, createFinalizeJob } = buildDeps({
      sample: sampleJob({ finalize_deadline_ms: DEADLINE_PAST }),
      replay: { generation_job_id: "305", cursor: 7 },
    });

    const res = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "key-1", deps);

    expect(res.code).toBe(200);
    expect(res.data).toEqual({ generation_job_id: "305", cursor: 7 });
    expect(createFinalizeJob).not.toHaveBeenCalled();
  });

  it("同键异载荷 → 幂等冲突（409 信封）", async () => {
    const { deps } = buildDeps({ replay: { kind: "idempotency_conflict" } });
    const res = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "key-1", deps);
    expect(res.code).toBe(100409);
  });

  it.each([
    ["非样片任务", { video_stage: "video" }, 1002, "仅样片任务可生成成片"],
    ["未成功", { status: "processing" }, 1002, "样片尚未成功交付，暂不能生成成片"],
    ["未转存", { output_asset_ids: [] }, 1002, "样片尚未完成转存，暂不能生成成片"],
  ])("★ 前置不满足（%s）→ 明确拒绝，零创建零扣费", async (_l, overrides, code, msg) => {
    const { deps, createFinalizeJob } = buildDeps({
      sample: sampleJob(overrides as never),
      quote: quoteStub().quote,
    });

    const res = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "key-1", deps);

    expect(res.code).toBe(code);
    expect(res.msg).toBe(msg);
    expect(createFinalizeJob).not.toHaveBeenCalled();
  });

  it("★ G05/G08: 样片已有成片（final_job_id 占位）→ 1057 finalize_already_attempted", async () => {
    const { deps } = buildDeps({ sample: sampleJob({ final_job_id: "305" }) });

    const res = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "key-1", deps);

    expect(res.code).toBe(1057);
  });

  it("★ IKIZQD: 上次成片提交结果不明（final job 停在 checking 锁定）→ 1014 submission_unknown，零创建零扣费", async () => {
    const { deps, createFinalizeJob } = buildDeps({
      sample: sampleJob({ final_job_id: "305", final_job_status: "checking" }),
      quote: quoteStub().quote,
    });

    const res = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "key-2", deps);

    // 契约 §六：核对锁定期间再次提交被拒（1014）——不发第二条上游尝试，预扣不动。
    expect(res.code).toBe(1014);
    expect(res.msg).toBe("无法确认视频任务是否已提交");
    expect(createFinalizeJob).not.toHaveBeenCalled();
  });

  it("★ IKIZQD: 成片 checking 期间报价 → 空报价双 null（按钮禁用，不报错）", async () => {
    const { quote } = quoteStub();
    const { deps } = buildDeps({
      sample: sampleJob({ final_job_id: "305", final_job_status: "checking" }),
      quote,
    });

    const res = await handleFinalizeGenerationJobQuote("42", "1", "302", {}, deps);

    expect(res.code).toBe(200);
    expect(res.data).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("★ G06: 缺可信截止 → 1058；已过期 → 1058（码表文案）", async () => {
    const nullDeadline = buildDeps({ sample: sampleJob({ finalize_deadline_ms: null }) });
    const res1 = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k", nullDeadline.deps);
    expect(res1.code).toBe(1058);
    expect(res1.msg).toContain("可信创建时间");

    const expired = buildDeps({ sample: sampleJob({ finalize_deadline_ms: DEADLINE_PAST }) });
    const res2 = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k", expired.deps);
    expect(res2.code).toBe(1058);
    expect(res2.msg).toContain("截止时间");
  });

  it("★ G03/G04: 确认字段缺失/非法 → 400；变价（credits 不一致）→ 1056；revision 失效 → 1056；算不出价 → 1056；未接报价依赖 → 1056", async () => {
    const quote = quoteStub().quote;
    // 缺字段：strict 校验拒绝（expected_credits 非正数同理）。
    const missing = buildDeps({ quote });
    expect(
      (await handleFinalizeGenerationJobCreate("42", "1", "302", { expected_credits: 76 }, "k", missing.deps)).code,
    ).toBe(1002);
    const zero = buildDeps({ quote });
    expect(
      (await handleFinalizeGenerationJobCreate("42", "1", "302", { ...happyBody(), expected_credits: 0 }, "k", zero.deps)).code,
    ).toBe(1002);

    // 变价：服务端复算 99，用户仍提交 76。
    const bumped = buildDeps({ quote: quoteStub({ credits: 99n }).quote });
    expect(
      (await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k", bumped.deps)).code,
    ).toBe(1056);

    // revision 失效：能力行版本跳变。
    const bumpedCap = { ...S25_CAPABILITY, version: 345 };
    const revisionStale = buildDeps({ capability: bumpedCap, quote: quoteStub().quote });
    expect(
      (await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k", revisionStale.deps)).code,
    ).toBe(1056);

    // 算不出价 / 未接依赖：fail closed。
    const unpriceable = buildDeps({ quote: vi.fn().mockResolvedValue(null) });
    expect(
      (await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k", unpriceable.deps)).code,
    ).toBe(1056);
    const noDep = buildDeps({});
    expect(
      (await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k", noDep.deps)).code,
    ).toBe(1056);
  });

  it("★ 模型停用 → 400 MODEL_UNAVAILABLE；未放行样片模式 → 400 capability_unsupported_param", async () => {
    const off = buildDeps({ capability: null, quote: quoteStub().quote });
    expect(
      (await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k", off.deps)).code,
    ).toBe(1005);

    const notOpen = buildDeps({
      capability: { model_id: "doubao-seedance-2-5-260628", features: {} },
      quote: quoteStub().quote,
    });
    expect(
      (await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k", notOpen.deps)).code,
    ).toBe(1030);
  });

  it("★ 幸福路径：派生 1080p 输入建任务 + 成片阶段预扣", async () => {
    const { result, quote } = quoteStub();
    const { deps, createFinalizeJob } = buildDeps({ quote });

    const res = await handleFinalizeGenerationJobCreate(
      "42", "1", "302", happyBody(), "key-1", deps,
    );

    expect(res.code).toBe(200);
    expect(res.data).toEqual({ generation_job_id: "305", cursor: 7 });
    const [createInput, options] = createFinalizeJob.mock.calls[0]!;
    expect(createInput).toMatchObject({
      projectId: "1",
      userId: "42",
      sourceSampleJobId: "302",
      actionType: "generate_video",
    });
    expect(createInput.input.resolution).toBe("1080p");
    expect(createInput.input.sample_mode).toBeUndefined();
    expect(options.billing).toBeDefined();
    // Hold 的 commandId 与 actionIdentity 同源（带 Date.now，防 billing 永久幂等死锁）。
    expect(options.billing.hold).toBeTypeOf("function");
    expect(result.credits).toBe(76n);
  });

  it("★ G05: repo 裁决 already_attempted（双击/两页并发）→ 1057；幂等冲突 → 409", async () => {
    const attempted = buildDeps({
      quote: quoteStub().quote,
      createResult: { kind: "finalize_already_attempted" },
    });
    const res = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k2", attempted.deps);
    expect(res.code).toBe(1057);

    const conflict = buildDeps({
      quote: quoteStub().quote,
      createResult: { kind: "idempotency_conflict" },
    });
    const res2 = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k3", conflict.deps);
    expect(res2.code).toBe(100409);
  });

  it("项目不存在/样片不存在 → 404（不泄露存在性）", async () => {
    const { deps } = buildDeps({ sample: null, quote: quoteStub().quote });
    const res = await handleFinalizeGenerationJobCreate("42", "1", "302", happyBody(), "k", deps);
    expect(res.code).toBe(100301);
  });
});
