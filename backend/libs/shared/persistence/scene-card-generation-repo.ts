import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CapabilitySnapshotVersion,
  FrozenGenerationParameters,
  ProviderPromptAsset,
  VideoReferenceMode,
} from "@lib/contracts";
import {
  aspectRatioIds,
  canonicalizeJsonValue,
  referenceModeToRequiredFeature,
  validateVideoReferenceConfiguration,
} from "@lib/contracts";

import { createJobWithinTx } from "./generation-command-repo.js";
import type { JobBilling, JobBillingSource } from "./job-billing.js";
import { jobExistenceProbe, releaseUnlessJobCommitted } from "./job-billing.js";
import { serializePricingRule } from "./model-capability-repo.js";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import { toFeatures, type ModelFeatures } from "./model-capability-repo.js";
import { transactionWithUniqueRetry } from "./conversation-repo.js";
import {
  validateDerivedReferences,
  type CapabilitySnapshot,
  type DerivedReference,
} from "./plan-application-repo.js";
import { validateStoryboardFrames } from "./storyboard-preview-repo.js";
import { checkReferenceLimits } from "../generation-runtime/reference-limits.js";
import {
  freezeReferenceLimits,
  type FrozenReferenceLimits,
} from "../generation-runtime/video-reference-validation.js";

const OPERATION = "scene_card.regenerate";

export interface RegenerateSceneCardInput {
  userId: string;
  projectId: string;
  sceneCardId: string;
  idempotencyKey: string;
  requestHash: string;
  base_scene_card_version: number;
  base_preset_version: number;
  parameters: FrozenGenerationParameters;
  reference_mode: VideoReferenceMode;
  reference_assets: ProviderPromptAsset[];
  capability_snapshot_version: CapabilitySnapshotVersion;
  billing?: JobBillingSource;
  guardInput?: (
    jobInput: Record<string, unknown>,
  ) => Promise<string | null>;
}

export type RegenerateSceneCardResult =
  | {
      kind: "applied";
      scene_card_id: string;
      generation_job_id: string;
      record_id: string;
      preset_version: number;
      cursor: string;
    }
  | {
      kind: "replayed";
      scene_card_id: string;
      generation_job_id: string;
      record_id: string;
    }
  | { kind: "idempotency_conflict" }
  | { kind: "scene_card_not_found" }
  | {
      kind: "version_conflict";
      current_scene_card_version: number;
      current_preset_version: number;
    }
  | { kind: "capability_drift" }
  | { kind: "capability_limit"; reason: string }
  | { kind: "validation_failed"; reason: string }
  | { kind: "material_blocked"; reason: string }
  | { kind: "forbidden" };

export interface SceneCardGenerationPresetView {
  scene_card: {
    scene_card_id: string;
    version: number;
    title: string;
    content_markdown: string;
  };
  preset: {
    version: number;
    parameters: unknown;
    reference_mode: string;
    reference_assets: unknown;
    capability_snapshot_version: unknown;
  };
}

export type SceneCardGenerationPresetViewResult =
  | ({ kind: "found" } & SceneCardGenerationPresetView)
  | { kind: "not_found" }
  | { kind: "forbidden" };

export interface SceneCardGenerationRepo {
  regenerateSceneCard(
    input: RegenerateSceneCardInput,
  ): Promise<RegenerateSceneCardResult>;
  getSceneCardGenerationPreset(
    projectId: string,
    sceneCardId: string,
    userId: string,
  ): Promise<SceneCardGenerationPresetViewResult>;
}

function checkCapabilityLimit(
  parameters: FrozenGenerationParameters,
  referenceMode: VideoReferenceMode,
  capability: {
    supported_sizes: unknown;
    supported_aspect_ratios: unknown;
    supported_durations: unknown;
    features: unknown;
  },
): string | null {
  const f = (capability.features ?? {}) as Record<string, unknown>;
  const taskType =
    referenceMode === "first_and_last_frame"
      ? "first_last_frame"
      : referenceMode === "first_frame" || referenceMode === "last_frame"
        ? "first_frame"
        : "default";
  const taskMap = f.task_types ?? f.taskTypes;
  const taskEntry =
    taskMap && typeof taskMap === "object" && !Array.isArray(taskMap)
      ? ((taskMap as Record<string, unknown>)[taskType] as
          | Record<string, unknown>
          | undefined)
      : undefined;
  const taskRatios = Array.isArray(taskEntry?.allowed_ratios)
    ? (taskEntry.allowed_ratios as string[])
    : null;
  const taskDurations = Array.isArray(taskEntry?.allowed_durations)
    ? (taskEntry.allowed_durations as number[])
    : null;

  const ratios =
    taskRatios ?? aspectRatioIds(capability.supported_aspect_ratios);
  if (!ratios.includes(parameters.aspect_ratio))
    return `aspect_ratio ${parameters.aspect_ratio} 不在能力支持范围`;
  const sizes = Array.isArray(capability.supported_sizes)
    ? (capability.supported_sizes as Array<{
        id?: string;
        api_value?: string;
      }>)
    : [];
  if (
    !sizes.some(
      (s) => s.id === parameters.size || s.api_value === parameters.size,
    )
  )
    return `size ${parameters.size} 不在能力支持范围`;
  const durations = taskDurations ?? capability.supported_durations;
  if (Array.isArray(durations)) {
    if (!durations.includes(parameters.duration))
      return `duration ${parameters.duration} 不在能力支持档位`;
  } else {
    const durRange = durations as { min?: number; max?: number } | null;
    if (
      durRange &&
      typeof durRange.min === "number" &&
      typeof durRange.max === "number" &&
      (parameters.duration! < durRange.min ||
        parameters.duration! > durRange.max)
    )
      return `duration ${parameters.duration} 超出能力范围`;
  }
  const quantityMax = Number(f.quantity_max ?? f.quantityMax ?? 1);
  if (parameters.count > quantityMax)
    return `count ${parameters.count} 超过 quantity_max ${quantityMax}`;
  const required = referenceModeToRequiredFeature(referenceMode);
  if (required) {
    const camel = required.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (!(f[required] === true || f[camel] === true)) {
      const label =
        required === "first_last_frame"
          ? "首尾帧"
          : required === "first_frame"
            ? "首帧"
            : "尾帧";
      return `当前模型不支持${label}参考模式`;
    }
  }
  return null;
}

async function checkReferenceCountLimits(
  tx: Prisma.TransactionClient,
  features: ModelFeatures,
  flatReferences: { reference_asset_ids?: string[] },
): Promise<string | null> {
  const ids = flatReferences.reference_asset_ids ?? [];
  if (ids.length === 0) return null;
  const rows = await tx.user_assets.findMany({
    where: { id: { in: ids.map((id) => BigInt(id)) } },
    select: { type: true, duration_ms: true },
  });
  const references: Array<{
    type: "image" | "video" | "audio";
    duration?: number;
  }> = [];
  for (const row of rows) {
    if (row.type !== "image" && row.type !== "video" && row.type !== "audio")
      continue;
    references.push({
      type: row.type,
      ...(row.type === "video" && row.duration_ms !== null
        ? { duration: row.duration_ms / 1000 }
        : {}),
    });
  }
  return checkReferenceLimits(features, references, "video");
}

function toDerivedReferences(
  assets: Extract<ProviderPromptAsset, { mention_id: string }>[],
): DerivedReference[] {
  return assets.map((asset) => ({
    mention_id: asset.mention_id,
    mention_seq: 0,
    type: asset.type,
    first_seen_offset: 0,
  }));
}

function isMentionAsset(
  asset: ProviderPromptAsset,
): asset is Extract<ProviderPromptAsset, { mention_id: string }> {
  return asset.type === "asset" || asset.type === "scene_card";
}

function isFrameAsset(
  asset: ProviderPromptAsset,
): asset is Extract<ProviderPromptAsset, { type: "storyboard_frame" }> {
  return asset.type === "storyboard_frame";
}

function isMentionAssetEntry(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const type = (value as Record<string, unknown>).type;
  return type === "asset" || type === "scene_card";
}

function validateReferenceAssetChanges(
  current: unknown,
  submitted: ProviderPromptAsset[],
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(current))
    return { ok: false, reason: "参考素材列表只能修改角色" };
  const currentMentions = current.filter(isMentionAssetEntry);
  const submittedMentions = submitted.filter(isMentionAsset);
  if (currentMentions.length !== submittedMentions.length)
    return { ok: false, reason: "参考素材列表只能修改角色" };
  const unchanged = submittedMentions.every((asset, index) => {
    const currentAsset = currentMentions[index];
    if (!currentAsset) return false;
    const immutableCurrent = Object.fromEntries(
      Object.entries(currentAsset).filter(([key]) => key !== "role"),
    );
    const immutableSubmitted = Object.fromEntries(
      Object.entries(asset).filter(([key]) => key !== "role"),
    );
    return (
      JSON.stringify(canonicalizeJsonValue(immutableCurrent)) ===
      JSON.stringify(canonicalizeJsonValue(immutableSubmitted))
    );
  });
  return unchanged
    ? { ok: true }
    : { ok: false, reason: "参考素材列表只能修改角色" };
}

export interface SceneCardChargeReference {
  role: string;
  type: string;
  asset_id: string;
  duration?: number;
}

export function sceneCardChargeInput(args: {
  parameters: FrozenGenerationParameters;
  prompt: string;
  references: SceneCardChargeReference[];
}): Record<string, unknown> {
  const duration = args.parameters.duration;
  return {
    model_id: args.parameters.model_id,
    resolution: args.parameters.size,
    aspect_ratio: args.parameters.aspect_ratio,
    ...(duration !== null ? { duration } : {}),
    prompt: args.prompt,
    expected_output_count: 1,
    ...(args.references.length > 0 ? { references: args.references } : {}),
  };
}

async function resolveReferenceAssetsToFlat(
  tx: Prisma.TransactionClient,
  referenceAssets: ProviderPromptAsset[],
): Promise<{
  flat: {
    first_frame_asset_id?: string;
    last_frame_asset_id?: string;
    reference_asset_ids?: string[];
  };
  chargeReferences: SceneCardChargeReference[];
}> {
  const frameSlotIds = referenceAssets
    .filter(isFrameAsset)
    .map((asset) => BigInt(asset.slot_id));
  const mentionTargetById = new Map<bigint, bigint>();
  const slotAssetById = new Map<bigint, bigint>();
  if (frameSlotIds.length > 0) {
    const slots = await tx.generation_output_slots.findMany({
      where: { id: { in: frameSlotIds } },
      select: { id: true, asset_id: true },
    });
    for (const slot of slots)
      if (slot.asset_id !== null) slotAssetById.set(slot.id, slot.asset_id);
  }
  const toAssetId = (asset: ProviderPromptAsset): string | null => {
    if (asset.type === "asset") {
      const target = mentionTargetById.get(BigInt(asset.mention_id));
      return target ? target.toString() : null;
    }
    if (asset.type === "storyboard_frame") {
      const target = slotAssetById.get(BigInt(asset.slot_id));
      return target ? target.toString() : null;
    }
    return null;
  };
  let firstFrameAssetId: string | undefined;
  let lastFrameAssetId: string | undefined;
  const referenceAssetIds: string[] = [];
  const rolesById: Array<{ id: string; role: string }> = [];
  for (const asset of referenceAssets) {
    const assetId = toAssetId(asset);
    if (assetId === null) continue;
    rolesById.push({ id: assetId, role: asset.role });
    if (asset.role === "first_frame") firstFrameAssetId = assetId;
    else if (asset.role === "last_frame") lastFrameAssetId = assetId;
    else referenceAssetIds.push(assetId);
  }
  const flat: {
    first_frame_asset_id?: string;
    last_frame_asset_id?: string;
    reference_asset_ids?: string[];
  } = {};
  if (firstFrameAssetId) flat.first_frame_asset_id = firstFrameAssetId;
  if (lastFrameAssetId) flat.last_frame_asset_id = lastFrameAssetId;
  if (referenceAssetIds.length > 0)
    flat.reference_asset_ids = referenceAssetIds;

  const assetRows =
    rolesById.length === 0
      ? []
      : await tx.user_assets.findMany({
          where: {
            id: { in: rolesById.map((entry) => BigInt(entry.id)) },
            is_delete: false,
          },
          select: { id: true, type: true, duration_ms: true },
        });
  const assetById = new Map(assetRows.map((row) => [row.id.toString(), row]));
  const chargeReferences: SceneCardChargeReference[] = rolesById.map(
    (entry) => {
      const row = assetById.get(entry.id);
      const type = row?.type ?? "image";
      const durationMs = row?.duration_ms ?? null;
      return {
        role: entry.role,
        type,
        asset_id: entry.id,
        ...(type === "video" && durationMs !== null && durationMs > 0
          ? { duration: durationMs / 1000 }
          : {}),
      };
    },
  );
  return { flat, chargeReferences };
}

async function regenerateSceneCardInTransaction(
  tx: Prisma.TransactionClient,
  input: RegenerateSceneCardInput,
  onCharged: (jobId: number) => void,
): Promise<RegenerateSceneCardResult> {
  const projectId = BigInt(input.projectId);
  const userId = BigInt(input.userId);
  const sceneCardId = BigInt(input.sceneCardId);

  const project = await tx.project.findFirst({
    where: { id: projectId, owner_id: userId, is_delete: 0 },
    select: { id: true },
  });
  if (!project) return { kind: "forbidden" } as const;

  const existing = await tx.project_command_receipts.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: projectId,
        operation: OPERATION,
        idempotency_key: input.idempotencyKey,
      },
    },
    select: {
      request_hash: true,
      resource_id: true,
      generation_job_id: true,
    },
  });
  if (existing) {
    if (existing.request_hash !== input.requestHash)
      return { kind: "idempotency_conflict" };
    if (existing.resource_id === null || existing.generation_job_id === null)
      return {
        kind: "validation_failed",
        reason: "idempotent record missing resources",
      };
    return {
      kind: "replayed",
      scene_card_id: existing.resource_id.toString(),
      generation_job_id: existing.generation_job_id.toString(),
      record_id: "0",
    };
  }

  const sceneCard = await tx.scene_cards.findFirst({
    where: { id: sceneCardId, project_id: projectId, is_delete: 0 },
    select: { id: true, content_markdown: true, version: true },
  });
  if (!sceneCard) return { kind: "scene_card_not_found" } as const;

  const preset = await tx.scene_card_generation_presets.findFirst({
    where: { scene_card_id: sceneCardId, is_delete: 0 },
    select: { id: true, version: true, reference_assets: true },
  });
  if (!preset) return { kind: "scene_card_not_found" } as const;

  if (
    sceneCard.version !== input.base_scene_card_version ||
    preset.version !== input.base_preset_version
  ) {
    return {
      kind: "version_conflict",
      current_scene_card_version: sceneCard.version,
      current_preset_version: preset.version,
    };
  }

  const referenceChanges = validateReferenceAssetChanges(
    preset.reference_assets,
    input.reference_assets,
  );
  if (!referenceChanges.ok)
    return { kind: "validation_failed", reason: referenceChanges.reason };

  const frameAssets = input.reference_assets.filter(isFrameAsset);
  const frameCheck = await validateStoryboardFrames(
    tx,
    projectId,
    sceneCardId,
    frameAssets,
  );
  if (!frameCheck.ok)
    return { kind: "validation_failed", reason: frameCheck.reason };

  const referenceRoleReason = validateVideoReferenceConfiguration(
    input.reference_mode,
    input.reference_assets,
  );
  if (referenceRoleReason)
    return { kind: "validation_failed", reason: referenceRoleReason };

  const snapshot =
    input.capability_snapshot_version as unknown as CapabilitySnapshot;
  if (
    input.parameters.capability_type !== snapshot.capability_type ||
    input.parameters.model_id !== snapshot.model_id ||
    input.parameters.provider_id !== snapshot.provider_id
  )
    return { kind: "capability_drift" } as const;


  const capability = await tx.catalog_models.findUnique({
    where: {
      provider_id_model_id: {
        provider_id: snapshot.provider_id,
        model_id: snapshot.model_id,
      },
    },
    select: {
      version: true,
      enabled: true,
      is_delete: true,
      capability_type: true,
      supported_sizes: true,
      supported_aspect_ratios: true,
      supported_durations: true,
      supported_formats: true,
      default_size: true,
      default_format: true,
      default_aspect_ratio: true,
      default_duration: true,
      features: true,
      pricing: true,
    },
  });
  if (!capability || !capability.enabled || capability.is_delete)
    return { kind: "capability_drift" } as const;
  const recomputedDigest = capabilityDigestFromModelCapability(capability);
  if (
    capability.version !== snapshot.row_version ||
    recomputedDigest !== snapshot.digest
  )
    return { kind: "capability_drift" } as const;

  const features = toFeatures(capability.features, capability.capability_type);

  const limitReason = checkCapabilityLimit(
    input.parameters,
    input.reference_mode,
    capability,
  );
  if (limitReason) return { kind: "capability_limit", reason: limitReason };

  const mentionAssets = input.reference_assets.filter(isMentionAsset);
  const referenceCheck = await validateDerivedReferences(
    tx,
    projectId,
    toDerivedReferences(mentionAssets),
  );
  if (!referenceCheck.ok)
    return { kind: "validation_failed", reason: referenceCheck.reason };

  const { flat: flatReferences, chargeReferences } =
    await resolveReferenceAssetsToFlat(tx, input.reference_assets);
  if (
    chargeReferences.some(
      (ref) => ref.type === "video" && ref.duration === undefined,
    )
  ) {
    return {
      kind: "validation_failed",
      reason: "参考视频时长读取失败，请稍后重试或更换素材",
    };
  }

  const referenceCountReason = await checkReferenceCountLimits(
    tx,
    features,
    flatReferences,
  );
  if (referenceCountReason)
    return { kind: "capability_limit", reason: referenceCountReason } as const;

  const frozenLimits: FrozenReferenceLimits = freezeReferenceLimits(features);

  if (input.guardInput) {
    const reason = await input.guardInput({ ...flatReferences });
    if (reason !== null) {
      return { kind: "material_blocked", reason } as const;
    }
  }


  const updateResult = await tx.scene_card_generation_presets.updateMany({
    where: {
      scene_card_id: sceneCardId,
      version: input.base_preset_version,
      is_delete: 0,
    },
    data: {
      parameters: input.parameters as unknown as Prisma.InputJsonValue,
      reference_mode: input.reference_mode,
      reference_assets:
        input.reference_assets as unknown as Prisma.InputJsonValue,
      capability_snapshot_version:
        input.capability_snapshot_version as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  if (updateResult.count === 0) {
    return {
      kind: "version_conflict",
      current_scene_card_version: sceneCard.version,
      current_preset_version: preset.version,
    };
  }
  const newPresetVersion = input.base_preset_version + 1;

  const ruleSnapshot = serializePricingRule({ pricing: capability.pricing });
  const jobBilling: JobBilling | undefined = input.billing
    ? {
        charge: async (jobId) => {
          await input.billing!.charge({
            userId: input.userId,
            jobId,
            commandId: input.idempotencyKey,
            modelId: snapshot.model_id,
            taskType: "video",
            input: sceneCardChargeInput({
              parameters: input.parameters,
              prompt: sceneCard.content_markdown,
              references: chargeReferences,
            }),
            ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
          });
          onCharged(jobId);
        },
        release: (jobId, reason) =>
          input.billing!.release({ userId: input.userId, jobId, reason }),
      }
    : undefined;

  const createdJob = await createJobWithinTx(tx, {
    projectId: input.projectId,
    userId: input.userId,
    type: "video",
    expectedOutputCount: 1,
    source: "scene_card",
    actionIdentity: input.idempotencyKey,
    actionType: "scene_card.video_regeneration",
    sceneCardId: sceneCardId.toString(),
    input: {
      scene_card_id: sceneCardId.toString(),
      prompt_text: sceneCard.content_markdown,
      parameters: input.parameters,
      reference_assets: input.reference_assets,
      reference_mode: input.reference_mode,
      capability_snapshot_version: input.capability_snapshot_version,
      reference_limits: frozenLimits,
      ...flatReferences,
    },
  }, jobBilling);
  if ("kind" in createdJob) throw new Error("unreachable: scene_card job creation never conflicts idempotency");
  const cursor = createdJob.cursor;

  const record = await tx.scene_card_generation_records.create({
    data: {
      scene_card_id: sceneCardId,
      project_id: projectId,
      summary_status: "generating",
      first_generation_job_id: BigInt(createdJob.generation_job_id),
    },
  });
  await tx.generation_output_slots.updateMany({
    where: { generation_job_id: BigInt(createdJob.generation_job_id) },
    data: { scene_card_generation_record_id: record.id },
  });

  await tx.project_command_receipts.create({
    data: {
      project_id: projectId,
      operation: OPERATION,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      generation_job_id: BigInt(createdJob.generation_job_id),
      resource_id: sceneCardId,
      accepted_cursor: BigInt(cursor),
    },
  });

  return {
    kind: "applied",
    scene_card_id: sceneCardId.toString(),
    generation_job_id: createdJob.generation_job_id,
    record_id: record.id.toString(),
    preset_version: newPresetVersion,
    cursor: cursor.toString(),
  };
}

export function createSceneCardGenerationRepo(
  prisma: PrismaClient,
): SceneCardGenerationRepo {
  return {
    regenerateSceneCard(input) {
      const charged: number[] = [];
      const releaseCharged = async () => {
        for (const jobId of charged.splice(0)) {
          await releaseUnlessJobCommitted({
            release: input.billing
              ? (id, reason) =>
                  input.billing!.release({ userId: input.userId, jobId: id, reason })
              : undefined,
            jobId,
            probe: jobExistenceProbe(prisma),
            reason: "事务重试或失败前释放上一笔扣款",
          });
        }
      };
      return transactionWithUniqueRetry(
        prisma,
        async (tx) => {
          await releaseCharged();
          return regenerateSceneCardInTransaction(tx, input, (jobId) =>
            charged.push(jobId),
          );
        },
        { maxWait: 10_000, timeout: 30_000 },
      ).catch(async (error: unknown) => {
        await releaseCharged();
        throw error;
      });
    },
    async getSceneCardGenerationPreset(projectId, sceneCardId, userId) {
      const pid = BigInt(projectId);
      const uid = BigInt(userId);
      const sid = BigInt(sceneCardId);
      const project = await prisma.project.findFirst({
        where: { id: pid, owner_id: uid, is_delete: 0 },
        select: { id: true },
      });
      if (!project) return { kind: "forbidden" } as const;
      const sceneCard = await prisma.scene_cards.findFirst({
        where: { id: sid, project_id: pid, is_delete: 0 },
        select: {
          id: true,
          title: true,
          content_markdown: true,
          version: true,
        },
      });
      if (!sceneCard) return { kind: "not_found" } as const;
      const preset = await prisma.scene_card_generation_presets.findFirst({
        where: { scene_card_id: sid, is_delete: 0 },
        select: {
          version: true,
          parameters: true,
          reference_mode: true,
          reference_assets: true,
          capability_snapshot_version: true,
        },
      });
      if (!preset) return { kind: "not_found" } as const;
      return {
        kind: "found",
        scene_card: {
          scene_card_id: sceneCard.id.toString(),
          version: sceneCard.version,
          title: sceneCard.title,
          content_markdown: sceneCard.content_markdown,
        },
        preset: {
          version: preset.version,
          parameters: preset.parameters,
          reference_mode: preset.reference_mode,
          reference_assets: preset.reference_assets,
          capability_snapshot_version: preset.capability_snapshot_version,
        },
      };
    },
  };
}
