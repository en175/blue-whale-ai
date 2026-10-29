import { createHash } from "node:crypto";

import {
  ERROR_CAPABILITY_UNSUPPORTED_PARAM,
  ERROR_FINALIZE_ALREADY_ATTEMPTED,
  ERROR_FINALIZE_DEADLINE_EXCEEDED,
  ERROR_INVALID_INPUT,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_QUOTE_STALE,
  ERROR_QUOTE_UNAVAILABLE,
  ERROR_SUBMISSION_UNKNOWN,
  IDEMPOTENCY_CONFLICT_CODE,
  JOB_STATUS_CHECKING,
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
import type { BillingCharge } from "../billing/billing-charge.js";
import type { BillingRelease } from "../billing/billing-release.js";
import type { JobBilling } from "../persistence/job-billing.js";
import type { CreateJobIdempotency } from "../persistence/generation-job-idempotency.js";
import { quoteRevisionOf } from "./handle-quote-generation-job.js";
import {
  canonicalJson,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  serializePricingRule,
} from "./handle-create-generation-job.js";

export type { FinalizeCommandRepo };

export interface FinalizeGenerationJobDeps {
  projects: Pick<ProjectRepo, "findOwnedById">;
  models: Pick<ModelCapabilityRepo, "listEnabledByType">;
  command: FinalizeCommandRepo;
  quote?: BillingQuote;
  billing?: { charge: BillingCharge; release: BillingRelease };
}

const EMPTY_QUOTE = { credits: null, quote_revision: null } as const;

const SAMPLE_ONLY_INPUT_KEYS = [
  "sample_mode",
  "placement_anchor",
  "target_node_id",
  "text_attachments",
  "prompt_plan_snapshot",
  "text_input_signature",
  "provider_credential",
] as const;

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

export function finalizePreconditionOf(sample: FinalizeSourceJob):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  if (sample.type !== "video" || sample.video_stage !== "sample") {
    return { ok: false, code: ERROR_INVALID_INPUT, message: "仅样片任务可生成成片" };
  }
  if (sample.final_job_id !== null) {
    if (sample.final_job_status === JOB_STATUS_CHECKING) {
      const numeric = errorCodeToNumeric(ERROR_SUBMISSION_UNKNOWN);
      return { ok: false, code: ERROR_SUBMISSION_UNKNOWN, message: messageOf(numeric) };
    }
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

function transferred(sample: FinalizeSourceJob): boolean {
  return (
    Array.isArray(sample.output_asset_ids) && sample.output_asset_ids.length > 0
  );
}

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

export async function handleFinalizeGenerationJobCreate(
  userId: string,
  projectId: string,
  jobId: string,
  body: unknown,
  idempotencyKey: string | null,
  deps: FinalizeGenerationJobDeps,
) {
  const parsed = videoFinalizeCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      errorCodeToNumeric(ERROR_INVALID_INPUT),
      "成片提交仅接受 expected_credits 与 quote_revision（上游输入由服务端从样片派生）",
      { code: ERROR_INVALID_INPUT },
    );
  }
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
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
  const replayed = await deps.command.lookupFinalizeIdempotency(projectId, idempotency);
  if (replayed) {
    return "kind" in replayed
      ? fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷")
      : ok(replayed);
  }
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
  const quoteDep = deps.quote;
  if (quoteDep === undefined) {
    return fail(errorCodeToNumeric(ERROR_QUOTE_UNAVAILABLE), messageOf(errorCodeToNumeric(ERROR_QUOTE_UNAVAILABLE)), {
      code: ERROR_QUOTE_UNAVAILABLE,
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
  if (quote === null) {
    return fail(errorCodeToNumeric(ERROR_QUOTE_UNAVAILABLE), messageOf(errorCodeToNumeric(ERROR_QUOTE_UNAVAILABLE)), {
      code: ERROR_QUOTE_UNAVAILABLE,
    });
  }
  if (
    Number(quote.credits) !== parsed.data.expected_credits ||
    currentRevision !== parsed.data.quote_revision
  ) {
    return fail(errorCodeToNumeric(ERROR_QUOTE_STALE), messageOf(errorCodeToNumeric(ERROR_QUOTE_STALE)), {
      code: ERROR_QUOTE_STALE,
    });
  }
  const finalInput: Record<string, unknown> = { ...derived };
  const actionSeed = `${projectId}\0${jobId}\0${normalizedKey}\0${Date.now()}`;
  const actionIdentity = createHash("sha256").update(actionSeed).digest("hex");
  const billingDep = deps.billing;
  const billing: JobBilling | undefined = billingDep
    ? {
        charge: (newJobId) =>
          billingDep.charge({
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
      const numeric = errorCodeToNumeric(ERROR_FINALIZE_ALREADY_ATTEMPTED);
      return fail(numeric, messageOf(numeric), { code: ERROR_FINALIZE_ALREADY_ATTEMPTED });
    }
    return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
  }
  return ok(created);
}
