/* ============================================
 * 成片（finalize）报价与提交 —— IKIZQC（契约 video-sample-mode.ts §3，金标 G02/G05/G13）
 *
 * 浏览器只带本仓样片任务 ID、报价确认两字段和 Idempotency-Key：提示词、参考、时长、
 * 比例、音频设置、上游 Draft ID 一概进不来（videoFinalizeCreateRequestSchema .strict()）。
 * 上游输入由服务端从样片**冻结输入**派生同模型 1080p 任务——Worker 拿样片保存的网关
 * 公开 task ID 调 finalize，浏览器与 Worker 都不接触上游 Draft ID（IKIZBR）。
 *
 * 与建任务链路的分工：报价侧 fail open（算不出/不可提交 → 空报价双 null），提交侧
 * fail closed（变价/无报价/前置不满足 → 明确错误码，零创建零扣费）——与样片创建/报价
 * （IKIZQ7/Q8）同一对语义，见 handle-quote-generation-job 顶部说明。
 * ============================================ */
import { createHash } from "node:crypto";

import {
  ERROR_CAPABILITY_UNSUPPORTED_PARAM,
  ERROR_FINALIZE_ALREADY_ATTEMPTED,
  ERROR_FINALIZE_DEADLINE_EXCEEDED,
  ERROR_INVALID_INPUT,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_QUOTE_STALE,
  IDEMPOTENCY_CONFLICT_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_FINAL_RESOLUTION,
  errorCodeToNumeric,
  fail,
  messageOf,
  ok,
  resolveOutputPixels,
  videoFinalizeCreateRequestSchema,
  videoFinalizeQuoteRequestSchema,
} from "@lib/contracts";
import type {
  FinalizeCommandRepo,
  FinalizeSourceJob,
  ModelCapabilityRepo,
  ModelCapabilityView,
  ProjectRepo,
} from "@lib/shared/persistence/index.js";
import type { BillingQuote } from "../billing/billing-quote.js";
import type { BillingHold } from "../billing/billing-hold.js";
import type { BillingRelease } from "../billing/billing-release.js";
import type { JobBilling } from "../persistence/job-billing.js";
import type { CreateJobIdempotency } from "../persistence/generation-job-idempotency.js";
import { quoteRevisionOf } from "./handle-quote-generation-job.js";
import {
  canonicalJson,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  serializePricingRule,
} from "./handle-create-generation-job.js";

/** 成片命令端口再导出（实现见 persistence/generation-finalize-repo.ts）。 */
export type { FinalizeCommandRepo };

export interface FinalizeGenerationJobDeps {
  projects: Pick<ProjectRepo, "findOwnedById">;
  models: Pick<ModelCapabilityRepo, "listEnabledByType">;
  command: FinalizeCommandRepo;
  /** 成片提交确认的复算依赖（与报价入口同一装配——预览价、核对价、实扣价三者同源）。
   *  缺省（未接线）时提交按无报价拒绝（fail closed）；报价侧缺省回空报价。 */
  quote?: BillingQuote;
  /** 成片阶段预扣与失败补偿（Hold/Release 按阶段独立——样片的结算不受影响）。 */
  billing?: { hold: BillingHold; release: BillingRelease };
}

/** 空报价（双 null，契约 StageQuoteView：不存在「有版本无价格」）。 */
const EMPTY_QUOTE = { credits: null, quote_revision: null } as const;

/** 样片冻结输入里**不属于成片**的键——成片由网关引用上游 Draft，不重放画布目标、
 *  样片标记与样片期凭证（成片用本次请求的新凭证，见 handler 内 assembly 顺序）。
 *  references / duration / aspect_ratio / generate_audio / reference_limits 原样保留：
 *  它们是计费规格（G13：输入视频时长取原参考素材，样片视频不计入）。 */
const SAMPLE_ONLY_INPUT_KEYS = [
  "sample_mode",
  "placement_anchor",
  "target_node_id",
  "text_attachments",
  "prompt_plan_snapshot",
  "text_input_signature",
  "provider_credential",
] as const;

/** 从样片冻结输入派生成片输入：同模型 + 1080p，剥掉样片/画布专属键，输出像素按 1080p 重算。
 *  量不出 model_id → null（数据异常，调用方按不可提交处理）。 */
export function deriveFinalizeInput(
  sampleInput: Record<string, unknown>,
  capability?: {
    features?: { video_dimensions?: unknown } | null;
  },
): Record<string, unknown> | null {
  const modelId = sampleInput.model_id;
  if (typeof modelId !== "string" || modelId === "") return null;
  const derived: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sampleInput)) {
    if ((SAMPLE_ONLY_INPUT_KEYS as readonly string[]).includes(key)) continue;
    derived[key] = value;
  }
  derived.resolution = VIDEO_FINAL_RESOLUTION;
  derived.expected_output_count = 1;
  // 样片期冻结的 480p 像素对成片无效：按 1080p 重算；算不出（如 adaptive 比例）就删键
  // ——assets.width/height 可空，宁缺毋错（与建任务「查不到不写 0」同口径）。
  delete derived.output_width;
  delete derived.output_height;
  const aspectRatio = derived.aspect_ratio;
  if (
    capability?.features &&
    typeof aspectRatio === "string"
  ) {
    const pixels = resolveOutputPixels(
      capability.features.video_dimensions,
      VIDEO_FINAL_RESOLUTION,
      aspectRatio,
    );
    if (pixels !== null) {
      derived.output_width = pixels.width;
      derived.output_height = pixels.height;
    }
  }
  return derived;
}

/** 成片前置条件（报价与提交共用一条判定；金标 G02/G05/G06/G08）。
 *  - ok：样片身份/成功/已转存/未被占/截止有效全部满足；
 *  - otherwise：code + message（提交侧原样透出；报价侧折成空报价）。 */
export function finalizePreconditionOf(sample: FinalizeSourceJob):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  if (sample.type !== "video" || sample.video_stage !== "sample") {
    return { ok: false, code: ERROR_INVALID_INPUT, message: "仅样片任务可生成成片" };
  }
  if (sample.final_job_id !== null) {
    // G05/G08：已有成片尝试（含失败占位）——首版一张样片至多一条，不复用同 Draft ID 重试。
    const numeric = errorCodeToNumeric(ERROR_FINALIZE_ALREADY_ATTEMPTED);
    return { ok: false, code: ERROR_FINALIZE_ALREADY_ATTEMPTED, message: messageOf(numeric) };
  }
  if (sample.status !== "succeeded") {
    return { ok: false, code: ERROR_INVALID_INPUT, message: "样片尚未成功交付，暂不能生成成片" };
  }
  if (!transferred(sample)) {
    return { ok: false, code: ERROR_INVALID_INPUT, message: "样片尚未完成转存，暂不能生成成片" };
  }
  if (sample.finalize_deadline_ms === null) {
    // G06：缺可信上游 created_at——样片保留，但成片禁用，不以替代时间猜测。
    return {
      ok: false,
      code: ERROR_FINALIZE_DEADLINE_EXCEEDED,
      message: "样片缺少可信创建时间，无法生成成片",
    };
  }
  if (Date.now() >= Number(sample.finalize_deadline_ms)) {
    const numeric = errorCodeToNumeric(ERROR_FINALIZE_DEADLINE_EXCEEDED);
    return { ok: false, code: ERROR_FINALIZE_DEADLINE_EXCEEDED, message: messageOf(numeric) };
  }
  return { ok: true };
}

/** 「已转存」判定：成功终态与自有 Asset 在 publishVideoResult 同事务落库——
 *  output_asset_ids 非空即已转存（金标 G14 的服务端投影面）。 */
function transferred(sample: FinalizeSourceJob): boolean {
  return (
    Array.isArray(sample.output_asset_ids) && sample.output_asset_ids.length > 0
  );
}

/** 报价与提交共用的能力解析：样片模型此刻仍启用且放行样片模式，才允许成片。
 *  返回 null = 模型不可用（报价折空报价；提交侧按 MODEL_UNAVAILABLE 拒）。 */
async function resolveCapability(
  deps: Pick<FinalizeGenerationJobDeps, "models">,
  sampleInput: Record<string, unknown>,
): Promise<{ modelId: string; row: ModelCapabilityView } | null> {
  const modelId = sampleInput.model_id;
  if (typeof modelId !== "string" || modelId === "") return null;
  const whitelist = await deps.models.listEnabledByType("video");
  const row = whitelist.find((m) => m.model_id === modelId);
  if (!row) return null;
  return { modelId, row };
}

/**
 * POST /api/projects/:projectId/generation-jobs/:jobId/finalize/quote（IKIZQC）。
 * 只读：不冻结、不写库、不碰余额。样片身份/成功/转存/截止/唯一尝试任一不满足，
 * 或模型已停用/未放行/算不出价 → 空报价双 null（前端据此禁用成片按钮）。
 */
export async function handleFinalizeGenerationJobQuote(
  userId: string,
  projectId: string,
  jobId: string,
  body: unknown,
  deps: FinalizeGenerationJobDeps,
) {
  if (!videoFinalizeQuoteRequestSchema.safeParse(body).success) {
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "成片报价请求体必须为空对象", {
      code: ERROR_INVALID_INPUT,
    });
  }
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  const sample = await deps.command.findFinalizeSourceJob({ projectId, userId, jobId });
  if (!sample) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if (!finalizePreconditionOf(sample).ok) return ok(EMPTY_QUOTE);
  const capability = await resolveCapability(deps, sample.input);
  if (capability === null || capability.row.features?.sample_mode !== true) {
    return ok(EMPTY_QUOTE);
  }
  const derived = deriveFinalizeInput(sample.input, capability.row);
  if (derived === null) return ok(EMPTY_QUOTE);
  const quoteDep = deps.quote;
  if (quoteDep === undefined) return ok(EMPTY_QUOTE);
  const ruleSnapshot = serializePricingRule(capability.row);
  const quote = await quoteDep({
    userId,
    modelId: capability.modelId,
    taskType: "video",
    input: derived,
    ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
  });
  if (quote === null) return ok(EMPTY_QUOTE);
  return ok({
    credits: Number(quote.credits),
    quote_revision: quoteRevisionOf({
      catalogVersion: quote.catalogVersion,
      capabilityVersion: capability.row.version,
      tier: quote.tier,
      quoteInput: derived,
    }),
  });
}

/** 成片提交请求摘要（与建任务/重试同形：method + operation + 资源路径 + 规范化 body）。 */
export function generationFinalizeRequestHash(
  projectId: string,
  jobId: string,
  body: unknown,
): string {
  return createHash("sha256")
    .update(
      `POST:generation.finalize:/projects/${projectId}/generation-jobs/${jobId}/finalize:${canonicalJson(body)}`,
    )
    .digest("hex");
}

/**
 * POST /api/projects/:projectId/generation-jobs/:jobId/finalize（IKIZQC）。
 *
 * 顺序（金标 G02/G03/G04/G05）：幂等重放（先于一切状态校验）→ 请求体 strict 校验 →
 * 项目/样片归属与前置条件 → 报价复算（quote_stale fail closed）→ 派生 1080p 输入 →
 * 建成片任务（来源唯一约束裁决并发）→ 入队由控制器负责。
 */
export async function handleFinalizeGenerationJobCreate(
  userId: string,
  projectId: string,
  jobId: string,
  body: unknown,
  idempotencyKey: string | null,
  deps: FinalizeGenerationJobDeps,
  internal: { providerCredential?: string } = {},
) {
  // 1. 请求体 strict（G02）：确认两字段之外任何键（prompt/references/duration/ratio/
  //    generate_audio/draft_task_id/source_draft_id…）直接拒绝，机械防线上游输入重放。
  const parsed = videoFinalizeCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      errorCodeToNumeric(ERROR_INVALID_INPUT),
      "成片提交仅接受 expected_credits 与 quote_revision（上游输入由服务端从样片派生）",
      { code: ERROR_INVALID_INPUT },
    );
  }
  // 2. 项目归属（不泄漏存在性）。
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  // 3. Idempotency-Key：成片提交必带（契约 §3「本次 Idempotency-Key」）。
  const normalizedKey = (idempotencyKey ?? "").trim();
  if (normalizedKey === "") {
    return fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key");
  }
  if (normalizedKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return fail(PARAM_MISSING_CODE, `Idempotency-Key 过长（上限 ${IDEMPOTENCY_KEY_MAX_LENGTH} 字符）`);
  }
  const idempotency: CreateJobIdempotency = {
    key: normalizedKey,
    requestHash: generationFinalizeRequestHash(projectId, jobId, parsed.data),
  };
  // 幂等重放先于状态校验（与建任务同一约定）：重放的是既有结果，不被此刻的状态改写。
  const replayed = await deps.command.lookupFinalizeIdempotency(projectId, idempotency);
  if (replayed) {
    return "kind" in replayed
      ? fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷")
      : ok(replayed);
  }
  // 4. 样片前置（fail closed）。
  const sample = await deps.command.findFinalizeSourceJob({ projectId, userId, jobId });
  if (!sample) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  const precondition = finalizePreconditionOf(sample);
  if (!precondition.ok) {
    return fail(errorCodeToNumeric(precondition.code), precondition.message, {
      code: precondition.code,
    });
  }
  const capability = await resolveCapability(deps, sample.input);
  if (capability === null) {
    return fail(errorCodeToNumeric(ERROR_MODEL_UNAVAILABLE), "model_id 不在可用模型白名单或已停用", {
      code: ERROR_MODEL_UNAVAILABLE,
    });
  }
  if (capability.row.features?.sample_mode !== true) {
    return fail(errorCodeToNumeric(ERROR_CAPABILITY_UNSUPPORTED_PARAM), "当前模型未开放样片模式", {
      code: ERROR_CAPABILITY_UNSUPPORTED_PARAM,
    });
  }
  // 5. 报价复算（G03/G04）：与报价入口同一装配、同一派生输入、同一指纹函数。
  const quoteDep = deps.quote;
  if (quoteDep === undefined) {
    return fail(errorCodeToNumeric(ERROR_QUOTE_STALE), "价格已更新，请刷新后重新确认提交", {
      code: ERROR_QUOTE_STALE,
    });
  }
  const derived = deriveFinalizeInput(sample.input, capability.row);
  if (derived === null) {
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "仅样片任务可生成成片", {
      code: ERROR_INVALID_INPUT,
    });
  }
  const ruleSnapshot = serializePricingRule(capability.row);
  const quote = await quoteDep({
    userId,
    modelId: capability.modelId,
    taskType: "video",
    input: derived,
    ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
  });
  const currentRevision =
    quote !== null
      ? quoteRevisionOf({
          catalogVersion: quote.catalogVersion,
          capabilityVersion: capability.row.version,
          tier: quote.tier,
          quoteInput: derived,
        })
      : null;
  if (
    quote === null ||
    Number(quote.credits) !== parsed.data.expected_credits ||
    currentRevision !== parsed.data.quote_revision
  ) {
    return fail(errorCodeToNumeric(ERROR_QUOTE_STALE), "价格已更新，请刷新后重新确认提交", {
      code: ERROR_QUOTE_STALE,
    });
  }
  // 6. 凭证：成片用**本次请求**的密封凭证（样片期冻结的已随派生剥除），挂在报价复算之后
  //    ——它不进任何指纹或报价输入。
  const finalInput: Record<string, unknown> = { ...derived };
  if (internal.providerCredential) {
    finalInput.provider_credential = internal.providerCredential;
  }
  // 7. 建成片任务（+成片阶段预扣）。actionIdentity 与建任务同式带 Date.now()：同一把
  //    key 的两次提交得到不同 commandId，规避 billing 永久幂等记录按 job_id 回放的死锁
  //    （见 handle-create-generation-job 第 8 步的完整说明，同一理由。
  const actionSeed = `${projectId}\0${jobId}\0${normalizedKey}\0${Date.now()}`;
  const actionIdentity = createHash("sha256").update(actionSeed).digest("hex");
  const billingDep = deps.billing;
  const billing: JobBilling | undefined = billingDep
    ? {
        hold: (newJobId) =>
          billingDep.hold({
            userId: String(userId),
            jobId: newJobId,
            commandId: actionIdentity,
            modelId: capability.modelId,
            taskType: "video",
            input: finalInput,
            ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
          }),
        release: (newJobId, reason) =>
          billingDep.release({ userId: String(userId), jobId: newJobId, reason }),
      }
    : undefined;
  const created = await deps.command.createFinalizeJob(
    {
      projectId,
      userId,
      sourceSampleJobId: sample.id,
      input: finalInput,
      actionIdentity,
      actionType: "generate_video",
    },
    { ...(billing ? { billing } : {}), idempotency },
  );
  if ("kind" in created) {
    if (created.kind === "finalize_already_attempted") {
      // G05：双击/两页并发——数据库唯一约束只放一条成片任务与一笔预扣。
      const numeric = errorCodeToNumeric(ERROR_FINALIZE_ALREADY_ATTEMPTED);
      return fail(numeric, messageOf(numeric), { code: ERROR_FINALIZE_ALREADY_ATTEMPTED });
    }
    return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
  }
  return ok(created);
}
