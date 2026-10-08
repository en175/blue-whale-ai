import {
  ERROR_INVALID_INPUT,
  RECOVERY_REASONS,
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

export function sampleRegeneratePreconditionOf(sample: FinalizeSourceJob):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  if (sample.type !== "video" || sample.video_stage !== "sample") {
    return { ok: false, code: ERROR_INVALID_INPUT, message: "仅样片任务可重新生成样片" };
  }
  return { ok: true };
}

function sampleRegenerateParametersOf(
  sampleInput: Record<string, unknown>,
): CreateGenerationJobBody["parameters"] {
  return {
    prompt: sampleInput.prompt,
    aspect_ratio: sampleInput.aspect_ratio,
    model_id: sampleInput.model_id,
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
  for (const [key, value] of Object.entries(sampleInput)) {
    if ((NON_REQUEST_INPUT_KEYS as readonly string[]).includes(key)) continue;
    if (key === "prompt" || key === "aspect_ratio" || key === "model_id" ||
        key === "resolution" || key === "duration" || key === "generate_audio") continue;
    (body as Record<string, unknown>)[key] = value;
  }
  return body;
}

export interface RegenerateSampleQuoteDeps {
  projects: Parameters<typeof handleQuoteGenerationJob>[3]["projects"];
  models: Parameters<typeof handleQuoteGenerationJob>[3]["models"];
  canvas: Parameters<typeof handleQuoteGenerationJob>[3]["canvas"];
  assets: Parameters<typeof handleQuoteGenerationJob>[3]["assets"];
  sampleSource: { findFinalizeSourceJob(args: {
    projectId: string;
    userId: string;
    jobId: string;
  }): Promise<FinalizeSourceJob | null> };
  quote?: BillingQuote;
}

export interface RegenerateSampleCreateDeps extends RegenerateSampleQuoteDeps {
  create: Parameters<typeof handleCreateGenerationJob>[4];
}

const EMPTY_QUOTE = { credits: null, quote_revision: null } as const;

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
  return handleQuoteGenerationJob(userId, projectId, derived, {
    projects: deps.projects,
    models: deps.models,
    canvas: deps.canvas,
    assets: deps.assets,
    quote: deps.quote,
  });
}

export async function handleRegenerateSampleCreate(
  userId: string,
  projectId: string,
  jobId: string,
  body: unknown,
  idempotencyKey: string | null,
  deps: RegenerateSampleCreateDeps,
) {
  const parsed = sampleRegenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    if (
      typeof body === "object" && body !== null
      && "canvas_binding" in body
    ) {
      return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
    }
    return fail(
      errorCodeToNumeric(ERROR_INVALID_INPUT),
      "重新生成样片仅接受 expected_credits、quote_revision 与 canvas_binding（输入由服务端从原样片派生）",
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
  return handleCreateGenerationJob(
    userId,
    projectId,
    { ...derived, ...parsed.data },
    idempotencyKey,
    deps.create,
  );
}
