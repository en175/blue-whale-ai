import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CHARGE_STATES,
  FINALIZE_SAFETY_MARGIN_MS,
  FINALIZE_WINDOW_DAYS,
  JOB_STATUS_CHECKING,
  VIDEO_STAGES,
  confirmedSubmitFieldsSchema,
  finalizeDeadlineFromUpstreamCreatedAt,
  sampleModeParametersSchema,
  sampleRegenerateRequestSchema,
  stageQuoteViewSchema,
  videoFinalizeCreateRequestSchema,
  videoFinalizeQuoteRequestSchema,
  videoStageAssetProjectionSchema,
  videoStageJobProjectionSchema,
} from "./video-sample-mode.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sampleModeParametersSchema", () => {
  it("接受 sample_mode=true + 480p", () => {
    expect(
      sampleModeParametersSchema.parse({ sample_mode: true, resolution: "480p" }),
    ).toEqual({ sample_mode: true, resolution: "480p" });
  });

  it("拒绝非 480p 分辨率与宽松真值", () => {
    expect(() =>
      sampleModeParametersSchema.parse({ sample_mode: true, resolution: "1080p" }),
    ).toThrow();
    expect(() =>
      sampleModeParametersSchema.parse({ sample_mode: "true", resolution: "480p" }),
    ).toThrow();
    expect(() =>
      sampleModeParametersSchema.parse({ sample_mode: 1, resolution: "480p" }),
    ).toThrow();
  });
});

describe("成片请求：浏览器只带提交确认，不重放输入", () => {
  it("提交请求接受 expected_credits + quote_revision", () => {
    expect(
      videoFinalizeCreateRequestSchema.parse({
        expected_credits: 19,
        quote_revision: "catalog-12:cap-345:tier-free",
      }),
    ).toEqual({ expected_credits: 19, quote_revision: "catalog-12:cap-345:tier-free" });
  });

  it("strict 拒绝输入重放与上游 Draft ID（IKIZPZ 成片契约）", () => {
    expect(() =>
      videoFinalizeCreateRequestSchema.parse({
        expected_credits: 19,
        quote_revision: "r1",
        prompt: "重放的提示词",
        duration: 5,
        ratio: "16:9",
        generate_audio: true,
      }),
    ).toThrow();
    expect(() =>
      videoFinalizeCreateRequestSchema.parse({
        expected_credits: 19,
        quote_revision: "r1",
        draft_task_id: "cgt-video-2026...",
      }),
    ).toThrow();
    expect(() =>
      videoFinalizeCreateRequestSchema.parse({
        expected_credits: 19,
        quote_revision: "r1",
        source_draft_id: "2026092910x",
      }),
    ).toThrow();
  });

  it("缺提交确认字段或金额为零/负数拒绝（不能按未确认金额提交）", () => {
    expect(() => videoFinalizeCreateRequestSchema.parse({})).toThrow();
    expect(() =>
      videoFinalizeCreateRequestSchema.parse({ expected_credits: 19 }),
    ).toThrow();
    expect(() =>
      videoFinalizeCreateRequestSchema.parse({ expected_credits: 0, quote_revision: "r1" }),
    ).toThrow();
    expect(() =>
      videoFinalizeCreateRequestSchema.parse({ expected_credits: -3, quote_revision: "r1" }),
    ).toThrow();
  });

  it("报价请求 body 为空对象且拒绝任何字段", () => {
    expect(videoFinalizeQuoteRequestSchema.parse({})).toEqual({});
    expect(() => videoFinalizeQuoteRequestSchema.parse({ expected_credits: 19 })).toThrow();
  });

  it("重新生成样片请求与成片提交同形（同样 strict）", () => {
    expect(
      sampleRegenerateRequestSchema.parse({ expected_credits: 4, quote_revision: "r2" }),
    ).toEqual({ expected_credits: 4, quote_revision: "r2" });
    expect(() =>
      sampleRegenerateRequestSchema.parse({
        expected_credits: 4,
        quote_revision: "r2",
        inherit_draft_id: true,
      }),
    ).toThrow();
  });

  it("★ IKJJR0：重新生成样片可携带可选 canvas_binding（合法绑定通过，非法载荷拒绝）", () => {
    const binding = {
      protocol_version: 1,
      submission_id: "0a1b2c3d-0000-4000-8000-000000000021",
      target_node_id: "video-node-regen-1",
      expected_binding_revision: 0,
      recovery_seed: {
        target: { role: "result-placeholder", x: 0, y: 0, width: 320, height: 180, name: "" },
        sources: [],
      },
    };
    expect(
      sampleRegenerateRequestSchema.parse({
        expected_credits: 4,
        quote_revision: "r2",
        canvas_binding: binding,
      }),
    ).toEqual({ expected_credits: 4, quote_revision: "r2", canvas_binding: binding });
    expect(() =>
      sampleRegenerateRequestSchema.parse({
        expected_credits: 4,
        quote_revision: "r2",
        canvas_binding: { ...binding, submission_id: "not-uuid" },
      }),
    ).toThrow();
  });
});

describe("stageQuoteViewSchema：无报价双 null，有报价双非空", () => {
  it("无报价 = 禁用该阶段提交的两字段形态", () => {
    expect(stageQuoteViewSchema.parse({ credits: null, quote_revision: null })).toEqual({
      credits: null,
      quote_revision: null,
    });
  });

  it("有报价必须带版本；版本存在必须带价格", () => {
    expect(() => stageQuoteViewSchema.parse({ credits: 19 })).toThrow();
    expect(() => stageQuoteViewSchema.parse({ quote_revision: "r1" })).toThrow();
    expect(
      stageQuoteViewSchema.parse({ credits: 19, quote_revision: "r1" }),
    ).toEqual({ credits: 19, quote_revision: "r1" });
  });
});

describe("投影：阶段、来源、截止、费用", () => {
  const finalJob = {
    video_stage: "final",
    source_sample_job_id: "302",
    final_job_id: null,
    finalize_deadline_at: null,
    charge_state: "held",
    actual_credits: null,
  };

  it("成片投影正例（来源指向样片任务，字符串 ID）", () => {
    expect(videoStageJobProjectionSchema.parse(finalJob)).toEqual(finalJob);
  });

  it("旧任务兼容：video 阶段 + 全 null 扩展字段", () => {
    const legacy = {
      video_stage: "video",
      source_sample_job_id: null,
      final_job_id: null,
      finalize_deadline_at: null,
      charge_state: null,
      actual_credits: null,
    };
    expect(videoStageJobProjectionSchema.parse(legacy)).toEqual(legacy);
  });

  it("数值 ID / 非法阶段 / 非法费用状态拒绝", () => {
    expect(() =>
      videoStageJobProjectionSchema.parse({ ...finalJob, source_sample_job_id: 302 }),
    ).toThrow();
    expect(() =>
      videoStageJobProjectionSchema.parse({ ...finalJob, video_stage: "draft" }),
    ).toThrow();
    expect(() =>
      videoStageJobProjectionSchema.parse({ ...finalJob, charge_state: "refunded" }),
    ).toThrow();
  });

  it("资产投影只含阶段与来源身份", () => {
    const asset = { video_stage: "sample", source_sample_job_id: null, final_job_id: "305" };
    expect(videoStageAssetProjectionSchema.parse(asset)).toEqual(asset);
    expect(() =>
      videoStageAssetProjectionSchema.parse({ ...asset, finalize_deadline_at: "2099-01-01T00:00:00Z" }),
    ).toThrow();
  });
});

describe("可信截止时间公式（金标 G06）", () => {
  it("截止 = 可信 created_at + 7 天 − 安全余量，严格早于官方窗口结束", () => {
    const created = Date.UTC(2026, 8, 29, 2, 0, 0);
    const deadline = finalizeDeadlineFromUpstreamCreatedAt(created);
    const deadlineMs = Date.parse(deadline);
    expect(deadlineMs).toBe(created + FINALIZE_WINDOW_DAYS * DAY_MS - FINALIZE_SAFETY_MARGIN_MS);
    expect(deadlineMs).toBeLessThan(created + FINALIZE_WINDOW_DAYS * DAY_MS);
    expect(deadline).toBe("2026-10-06T01:00:00.000Z");
  });
});

describe("枚举值冻结（跨语言对账锚点）", () => {
  it("阶段 / 费用状态 / 核对状态是封闭集合", () => {
    expect(VIDEO_STAGES).toEqual(["video", "sample", "final"]);
    expect(CHARGE_STATES).toEqual(["held", "settled", "released"]);
    expect(JOB_STATUS_CHECKING).toBe("checking");
    expect(videoFinalizeCreateRequestSchema).toBe(confirmedSubmitFieldsSchema);
    expect(sampleRegenerateRequestSchema.shape.canvas_binding).toBeDefined();
    expect(Object.keys(sampleRegenerateRequestSchema.shape)).toEqual([
      "expected_credits",
      "quote_revision",
      "canvas_binding",
    ]);
  });
});

describe("跨语言金标用例 JSON 对账", () => {
  const golden = JSON.parse(
    readFileSync(
      new URL("../../../docs/specs/2026-09-29-ikizq5-video-sample-mode-golden-cases.json", import.meta.url),
      "utf8",
    ),
  ) as Array<{ case_id: string; contract_ref: string; title_zh: string; given: string; expect: string }>;

  it("用例结构完整且 case_id 唯一", () => {
    expect(golden.length).toBeGreaterThanOrEqual(12);
    const ids = golden.map((c) => c.case_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of golden) {
      expect(c.contract_ref).toMatch(/^§/);
      expect(c.title_zh.length).toBeGreaterThan(0);
      expect(c.given.length).toBeGreaterThan(0);
      expect(c.expect.length).toBeGreaterThan(0);
    }
  });

  it("验收点名的契约字段都被至少一条金标覆盖（防契约漂移）", () => {
    const contractFields = new Set([
      ...Object.keys(videoStageJobProjectionSchema.shape),
      ...Object.keys(videoStageAssetProjectionSchema.shape),
      ...Object.keys(confirmedSubmitFieldsSchema.shape),
      ...Object.keys(stageQuoteViewSchema.shape),
      ...Object.keys(sampleModeParametersSchema.shape),
    ]);
    const text = golden.map((c) => `${c.given} ${c.expect}`).join("\n");
    const uncovered = [...contractFields].filter((f) => !text.includes(f));
    expect(uncovered).toEqual([]);
  });
});
