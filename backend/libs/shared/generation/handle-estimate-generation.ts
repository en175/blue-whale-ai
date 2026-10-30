import type { ResultEnvelope } from "@lib/contracts";
import {
  FROZEN_VIDEO_MODE_KEY,
  frozenVideoModeOf,
  normalizeVideoMode,
  ok,
  resolveVideoMode,
} from "@lib/contracts";
import type { ModelCapabilityRepo } from "@lib/shared/persistence/index.js";

import type { BillingQuote } from "../billing/billing-quote.js";
import {
  applyEditSourceDurationBasis,
  projectQuoteInput,
  ruleSampleMode,
  serializePricingRule,
  type CreateGenerationJobBody,
  type GenerationType,
} from "./handle-create-generation-job.js";

export interface EstimateGenerationDeps {
  models: Pick<ModelCapabilityRepo, "listEnabledByType">;
  quote: BillingQuote;
}

export interface EstimateGenerationData {
  credits: number | null;
}

const EMPTY_ESTIMATE: EstimateGenerationData = { credits: null };

export async function handleEstimateGeneration(
  userId: string,
  body: CreateGenerationJobBody,
  deps: EstimateGenerationDeps,
): Promise<ResultEnvelope<EstimateGenerationData>> {
  const type = body.type;
  if (type !== "image" && type !== "video") return ok(EMPTY_ESTIMATE);

  const params = body.parameters as
    | {
        model_id?: unknown;
        sample_mode?: unknown;
        resolution?: unknown;
        mode?: unknown;
        prompt?: unknown;
      }
    | undefined;
  const modelId = typeof params?.model_id === "string" ? params.model_id : null;
  if (modelId === null) return ok(EMPTY_ESTIMATE);

  const capability = (await deps.models.listEnabledByType(type)).find(
    (model) => model.model_id === modelId,
  );
  if (!capability) return ok(EMPTY_ESTIMATE);

  const expectedOutputCount =
    typeof body.expected_output_count === "number" &&
    Number.isInteger(body.expected_output_count) &&
    body.expected_output_count > 0
      ? body.expected_output_count
      : 1;

  const ruling = ruleSampleMode({
    type,
    sampleMode: params?.sample_mode,
    resolution: params?.resolution,
    expectedOutputCount,
    capability,
  });
  if (ruling.kind === "rejected") return ok(EMPTY_ESTIMATE);

  const input = projectQuoteInput(
    type,
    { ...body, references: undefined, expected_output_count: expectedOutputCount },
    capability,
  );
  if (input === null) return ok(EMPTY_ESTIMATE);

  const estimateReferences = applyEstimateReferences(input, type, body.references);
  if (type === "video" && normalizeVideoMode(params?.mode) === null) {
    input[FROZEN_VIDEO_MODE_KEY] = resolveVideoMode(
      estimateReferences,
      typeof params?.prompt === "string" ? params.prompt : "",
    );
  }
  applyEditSourceDurationBasis(
    input,
    frozenVideoModeOf(input),
    capability.features?.task_types,
  );

  const ruleSnapshot = serializePricingRule(capability);
  const quote = await deps.quote({
    userId,
    modelId,
    taskType: type,
    input,
    ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
  });
  if (quote === null) return ok(EMPTY_ESTIMATE);
  return ok({ credits: Number(quote.credits) });
}

type EstimateReference = {
  role: "reference";
  type: "image" | "video";
  duration?: number;
};

function applyEstimateReferences(
  input: Record<string, unknown>,
  type: GenerationType,
  raw: unknown,
): EstimateReference[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const references: EstimateReference[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { type: refType, duration } = item as { type?: unknown; duration?: unknown };
    if (refType !== "image" && refType !== "video") continue;
    if (type === "image" && refType !== "image") continue;
    const seconds =
      typeof duration === "number" && Number.isFinite(duration) && duration > 0
        ? duration
        : undefined;
    references.push({
      role: "reference",
      type: refType,
      ...(seconds !== undefined ? { duration: seconds } : {}),
    });
  }
  if (references.length === 0) return references;

  if (type === "image") {
    input.input_asset_ids = references.map((_, index) => String(index + 1));
    return references;
  }
  input.references = references;
  return references;
}
