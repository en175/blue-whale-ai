/* ============================================
 * 重新生成样片（regenerate-sample）—— IKIZQF（契约 video-sample-mode.ts §5，金标 G10）
 *
 * 过期或成片失败后的「重新生成样片」：独立报价与提交入口，从原样片**冻结输入**派生
 * 一份**创建请求**，走与首次创建完全相同的 {@link handleCreateGenerationJob} 链路
 * （幂等 / 样片门控 / 素材复核 / 报价复算 / 预扣 / video_stage='sample' 落库）——
 * 新任务新卡，不继承旧报价、旧截止或旧 Draft ID；旧样片、失败成片及其费用记录只读不写。
 *
 * 与 finalize（IKIZQC）的分工：finalize 从样片派生 1080p 成片（新链路、来源唯一约束）；
 * 重新生成从样片派生 480p **新样片**——它就是一次新的创建，输入来自旧任务冻结快照而
 * 非浏览器重传（派生 body 进创建管线后，门控/素材/价格全部按**当前**状态重新校验）。
 * 报价侧 fail open（算不出 / 未放行 → 空报价双 null），提交侧 fail closed
 * （变价 / 前置不满足 → 明确错误码，零创建零扣费）——与样片创建/成片同一对语义。
 * ============================================ */
import {
  ERROR_INVALID_INPUT,
  RESOURCE_NOT_FOUND_CODE,
  errorCodeToNumeric,
  fail,
  ok,
  sampleRegenerateRequestSchema,
  videoFinalizeQuoteRequestSchema,
} from "@lib/contracts";
import type { FinalizeSourceJob } from "@lib/shared/persistence/index.js";
import type { BillingQuote } from "../billing/billing-quote.js";
import { handleCreateGenerationJob, type CreateGenerationJobBody } from "./handle-create-generation-job.js";
import { handleQuoteGenerationJob } from "./handle-quote-generation-job.js";

/** 冻结输入里**不进重新生成创建请求**的键——与 finalize 的 SAMPLE_ONLY_INPUT_KEYS 同口径
 *  （画布目标/快照属旧任务的创建现场，新样片是独立新卡；凭证用本次请求的新凭证），
 *  另加三组创建管线会**重新冻结**的键：sample_mode（重建进 parameters.sample_mode=true）、
 *  reference_limits 与 output_width/height（能力行现查现冻——「重新校验能力规则」）。
 *  references（含视频时长）/ 旧参考字段 / prompt / duration / generate_audio 原样保留：
 *  它们既是创作输入也是计费规格（G13）。 */
const NON_REQUEST_INPUT_KEYS = [
  "sample_mode",
  "placement_anchor",
  "target_node_id",
  "text_attachments",
  "prompt_plan_snapshot",
  "text_input_signature",
  "provider_credential",
  "reference_limits",
  "output_width",
  "output_height",
  "expected_output_count",
] as const;

/** 重新生成前置（报价与提交共用一条；金标 G10）：原任务必须是本人的样片任务。
 *  「过期」与「成片失败」是入口场景**不是**门控——过期样片、已占成片（失败占位）的
 *  样片都可重新生成（与 finalize_precondition 的差异正是两张入口的分工：过期只阻止
 *  转成片 1058，失败占位只锁 finalize 重试 1057）。 */
export function sampleRegeneratePreconditionOf(sample: FinalizeSourceJob):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  if (sample.type !== "video" || sample.video_stage !== "sample") {
    return { ok: false, code: ERROR_INVALID_INPUT, message: "仅样片任务可重新生成样片" };
  }
  return { ok: true };
}

/** 从样片冻结输入派生创建请求 body（type=video + 480p + sample_mode=true + 单输出）。
 *  量不出 model_id → null（数据异常：调用方按不可提交处置）。 */
/** parameters 重建：正文/比例/模型原样，480p 与 sample_mode=true 由样片形态重立；
 *  duration / generate_audio 是用户选择，冻结过就原样带回。 */
function sampleRegenerateParametersOf(
  sampleInput: Record<string, unknown>,
): CreateGenerationJobBody["parameters"] {
  return {
    prompt: sampleInput.prompt,
    aspect_ratio: sampleInput.aspect_ratio,
    model_id: sampleInput.model_id,
    // 样片任务冻结的 resolution 必为 480p；缺失时由样片门控按契约拒绝（不猜）。
    ...(typeof sampleInput.resolution === "string" ? { resolution: sampleInput.resolution } : {}),
    ...(sampleInput.duration !== undefined ? { duration: sampleInput.duration } : {}),
    ...(sampleInput.generate_audio !== undefined ? { generate_audio: sampleInput.generate_audio } : {}),
    sample_mode: true,
  };
}

export function deriveSampleRegenerateBody(
  sampleInput: Record<string, unknown>,
): CreateGenerationJobBody | null {
  const modelId = sampleInput.model_id;
  if (typeof modelId !== "string" || modelId === "") return null;
  for (const key of ["prompt", "aspect_ratio"] as const) {
    if (typeof sampleInput[key] !== "string") return null;
  }
  const body: CreateGenerationJobBody = {
    type: "video",
    expected_output_count: 1,
    parameters: sampleRegenerateParametersOf(sampleInput),
  };
  // 参考字段：原任务怎么冻的就怎么放回（单数组 references 或旧字段二选一，创建管线
  // 重新做存在性/类型/时长复核——「按当前素材状态重新校验」）。
  for (const [key, value] of Object.entries(sampleInput)) {
    if ((NON_REQUEST_INPUT_KEYS as readonly string[]).includes(key)) continue;
    if (key === "prompt" || key === "aspect_ratio" || key === "model_id" ||
        key === "resolution" || key === "duration" || key === "generate_audio") continue;
    (body as Record<string, unknown>)[key] = value;
  }
  return body;
}

/** 重新生成报价依赖（提交端点在此之上加 create——见 RegenerateSampleCreateDeps）。 */
export interface RegenerateSampleQuoteDeps {
  projects: Parameters<typeof handleQuoteGenerationJob>[3]["projects"];
  models: Parameters<typeof handleQuoteGenerationJob>[3]["models"];
  /** 原样片读取（复用 IKIZQC 的来源样片投影：input/video_stage 全在里面）。 */
  sampleSource: { findFinalizeSourceJob(args: {
    projectId: string;
    userId: string;
    jobId: string;
  }): Promise<FinalizeSourceJob | null> };
  /** 报价函数（与 /quote、finalize/quote 同一装配）。缺省 → 空报价（fail open）。 */
  quote?: BillingQuote;
}

export interface RegenerateSampleCreateDeps extends RegenerateSampleQuoteDeps {
  /** 创建管线全部依赖（控制器按 create 端点同一装配注入：幂等/门控/素材复核/预扣全链）。
   *  其中的 projects/models/quote 与外层同实例——报价与提交复算天然同源。 */
  create: Parameters<typeof handleCreateGenerationJob>[4];
}

/** 空报价（双 null，契约 StageQuoteView）。 */
const EMPTY_QUOTE = { credits: null, quote_revision: null } as const;

/**
 * POST /api/projects/:projectId/generation-jobs/:jobId/regenerate-sample/quote（IKIZQF）。
 * 只读：不冻结、不写库、不碰余额。非样片任务 / 模型已停用或未放行 / 算不出价 →
 * 空报价双 null（前端据此禁用重新生成按钮）。过期与成片失败**不影响**此处报价。
 */
export async function handleRegenerateSampleQuote(
  userId: string,
  projectId: string,
  jobId: string,
  body: unknown,
  deps: RegenerateSampleQuoteDeps,
) {
  if (!videoFinalizeQuoteRequestSchema.safeParse(body).success) {
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "重新生成报价请求体必须为空对象", {
      code: ERROR_INVALID_INPUT,
    });
  }
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  const sample = await deps.sampleSource.findFinalizeSourceJob({ projectId, userId, jobId });
  if (!sample) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if (!sampleRegeneratePreconditionOf(sample).ok) return ok(EMPTY_QUOTE);
  if (deps.quote === undefined) return ok(EMPTY_QUOTE);
  const derived = deriveSampleRegenerateBody(sample.input);
  if (derived === null) return ok(EMPTY_QUOTE);
  // 报价走创建入口的同一 handler：门控（ruleSampleMode）、规格投影（projectQuoteInput）、
  // 指纹（quoteRevisionOf）与提交复算出自同一派生 body——三处同源。
  return handleQuoteGenerationJob(userId, projectId, derived, {
    projects: deps.projects,
    models: deps.models,
    quote: deps.quote,
  });
}

/**
 * POST /api/projects/:projectId/generation-jobs/:jobId/regenerate-sample（IKIZQF）。
 *
 * 顺序（金标 G10）：请求体 strict 校验 → 项目/样片归属与前置 → 从冻结输入派生创建请求
 * （并入提交确认两字段）→ handleCreateGenerationJob 全链（幂等重放 / 样片门控 / 素材
 * 复核 / 报价复算 quote_stale fail closed / 预扣 / video_stage='sample' 落库）。
 * 重复请求（同 Idempotency-Key）由创建域 command_idempotency 重放首次结果——只建一次。
 */
export async function handleRegenerateSampleCreate(
  userId: string,
  projectId: string,
  jobId: string,
  body: unknown,
  idempotencyKey: string | null,
  deps: RegenerateSampleCreateDeps,
  internal: { providerCredential?: string } = {},
) {
  // strict：确认两字段之外任何键（prompt/references/draft_task_id…）直接拒绝——
  // 上游输入只来自原样片冻结快照，浏览器不重传（契约 §5）。
  const parsed = sampleRegenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      errorCodeToNumeric(ERROR_INVALID_INPUT),
      "重新生成样片仅接受 expected_credits 与 quote_revision（输入由服务端从原样片派生）",
      { code: ERROR_INVALID_INPUT },
    );
  }
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  const sample = await deps.sampleSource.findFinalizeSourceJob({ projectId, userId, jobId });
  if (!sample) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  const precondition = sampleRegeneratePreconditionOf(sample);
  if (!precondition.ok) {
    return fail(errorCodeToNumeric(precondition.code), precondition.message, {
      code: precondition.code,
    });
  }
  const derived = deriveSampleRegenerateBody(sample.input);
  if (derived === null) {
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "原样片输入缺失，无法重新生成", {
      code: ERROR_INVALID_INPUT,
    });
  }
  // 一次新的创建：幂等、门控、素材复核、报价复算、预扣、阶段落库全部在创建管线里，
  // 本层零旁路——旧任务行与费用记录从头到尾只被读过，不被覆盖或删除。
  return handleCreateGenerationJob(
    userId,
    projectId,
    { ...derived, ...parsed.data },
    idempotencyKey,
    deps.create,
    internal,
  );
}
