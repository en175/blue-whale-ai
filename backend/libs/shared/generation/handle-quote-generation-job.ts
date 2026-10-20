import { createHash } from "node:crypto";

import { RESOURCE_NOT_FOUND_CODE, fail, frozenVideoModeOf, ok, type ResultEnvelope } from "@lib/contracts";
import {
  DEFAULT_IMAGE_REFERENCE_MAX,
  type AssetOwnershipOps,
  type CanvasRepo,
  type ModelCapabilityRepo,
  type ProjectRepo,
} from "@lib/shared/persistence/index.js";

import type { BillingQuote } from "../billing/billing-quote.js";
import type { AssetProbe } from "../assets/ports.js";
import {
  resolveReferenceDurations,
  videoAssetIdsForDuration,
} from "./resolve-reference-durations.js";
import {
  applyEditSourceDurationBasis,
  canonicalJson,
  projectQuoteInput,
  resolveReferenceAssets,
  resolveTextIndexReferences,
  ruleSampleMode,
  type CreateGenerationJobBody,
  type GenerationType,
  serializePricingRule,
} from "./handle-create-generation-job.js";

export interface QuoteGenerationJobDeps {
  projects: Pick<ProjectRepo, "findOwnedById">;
  models: Pick<ModelCapabilityRepo, "listEnabledByType">;
  canvas: Pick<CanvasRepo, "getByProject">;
  assets: Pick<AssetOwnershipOps, "resolveInputAssets"> &
    Partial<Pick<AssetOwnershipOps, "findStorageKeys" | "saveMediaInfo">>;
  probe?: AssetProbe;
  quote: BillingQuote;
}

export interface QuoteGenerationJobData {
  credits: number | null;
  quote_revision: string | null;
  duration_basis?: "source_video";
}

const EMPTY_QUOTE: QuoteGenerationJobData = { credits: null, quote_revision: null };

export function quoteRevisionOf(args: {
  catalogVersion: number;
  capabilityVersion: number | undefined;
  tier: string;
  quoteInput: Record<string, unknown>;
}): string {
  const inputFingerprint = createHash("sha256")
    .update(canonicalJson(args.quoteInput))
    .digest("hex")
    .slice(0, 12);
  const cap = args.capabilityVersion === undefined ? "none" : String(args.capabilityVersion);
  return `catalog-${args.catalogVersion}:cap-${cap}:tier-${args.tier}:input-${inputFingerprint}`;
}

export async function handleQuoteGenerationJob(
  userId: string,
  projectId: string,
  body: CreateGenerationJobBody,
  deps: QuoteGenerationJobDeps,
): Promise<ResultEnvelope<QuoteGenerationJobData | null>> {
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const type = body.type as GenerationType;
  const params = body.parameters as
    | { model_id?: unknown; sample_mode?: unknown; resolution?: unknown }
    | undefined;
  const modelId = typeof params?.model_id === "string" ? params.model_id : null;
  if (modelId === null) return ok(EMPTY_QUOTE);

  const whitelist = await deps.models.listEnabledByType(type);
  const capability = whitelist.find((m) => m.model_id === modelId);
  if (!capability) return ok(EMPTY_QUOTE);

  const ruling = ruleSampleMode({
    type,
    sampleMode: params?.sample_mode,
    resolution: params?.resolution,
    expectedOutputCount: Number(body.expected_output_count),
    capability,
  });
  if (ruling.kind === "rejected") return ok(EMPTY_QUOTE);

  let effectiveBody: CreateGenerationJobBody = body;
  const targetNodeId =
    typeof body.target_node_id === "string" && body.target_node_id.trim() !== ""
      ? body.target_node_id
      : null;
  if (type === "video" && targetNodeId !== null) {
    const textIndexRefs = await resolveTextIndexReferences({
      type,
      body,
      projectId,
      deps: { canvas: deps.canvas },
      directReferenceAssetIds: [],
      imageReferenceMax:
        capability?.features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX,
      ...(capability ? { capability } : {}),
    });
    if (!textIndexRefs.ok) return ok(EMPTY_QUOTE);
    if (textIndexRefs.value.videoReferences) {
      const merged = textIndexRefs.value.videoReferences;
      const ruling = await resolveReferenceDurations({
        references: merged,
        assetIdsOf: videoAssetIdsForDuration,
        userId,
        projectId,
        assets: deps.assets,
        ...(deps.probe ? { probe: deps.probe } : {}),
      });
      effectiveBody = {
        ...body,
        references: ruling.kind === "resolved" ? ruling.references : merged,
      };
    }
  }

  let quoteReferenceAssetIds: Array<string | number> | undefined;
  if (type === "image" && targetNodeId !== null) {
    const imageReferenceMax =
      capability?.features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX;
    const direct = resolveReferenceAssets(body, type, imageReferenceMax);
    if (!direct.ok) return ok(EMPTY_QUOTE);
    const textIndexRefs = await resolveTextIndexReferences({
      type,
      body,
      projectId,
      deps: { canvas: deps.canvas },
      directReferenceAssetIds: direct.value.referenceAssetIds,
      imageReferenceMax,
      ...(capability ? { capability } : {}),
    });
    if (!textIndexRefs.ok) return ok(EMPTY_QUOTE);
    quoteReferenceAssetIds = textIndexRefs.value.merged;
  }

  const input = projectQuoteInput(type, effectiveBody, capability, quoteReferenceAssetIds);
  if (input === null) return ok(EMPTY_QUOTE);

  const quoteParams = effectiveBody.parameters as { prompt?: unknown } | undefined;
  const prompt = typeof quoteParams?.prompt === "string" ? quoteParams.prompt : "";
  const bySourceVideo = applyEditSourceDurationBasis(
    input,
    frozenVideoModeOf(input),
    capability?.features?.task_types,
  );

  const ruleSnapshot = serializePricingRule(capability);
  const quote = await deps.quote({
    userId,
    modelId,
    taskType: type,
    input,
    ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
  });
  if (quote === null) return ok(EMPTY_QUOTE);
  return ok({
    credits: Number(quote.credits),
    quote_revision: quoteRevisionOf({
      catalogVersion: quote.catalogVersion,
      capabilityVersion: capability.version,
      tier: quote.tier,
      quoteInput: input,
    }),
    ...(bySourceVideo ? { duration_basis: "source_video" as const } : {}),
  });
}
