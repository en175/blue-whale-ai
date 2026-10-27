import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CapabilitySnapshotVersion,
  ProviderPromptAsset,
  StoryboardFrameView,
  StoryboardPreviewParameters,
} from "@lib/contracts";
import { aspectRatioIds } from "@lib/contracts";

import { createJobWithinTx } from "./generation-command-repo.js";
import {
  canvasBindingView,
  lockCanvasRecoveryForAcceptance,
  writeCanvasRecoveryRows,
  type CanvasBindingView,
  type CanvasRecoveryAcceptance,
  type CanvasRecoveryPlan,
} from "./generation-canvas-recovery-repo.js";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import { appendProjectEvent } from "./product-event-repo.js";
import { transactionWithUniqueRetry } from "./conversation-repo.js";

const OPERATION = "scene_card.storyboard_preview";

export interface CreateStoryboardPreviewInput {
  userId: string;
  projectId: string;
  sceneCardId: string;
  idempotencyKey: string;
  requestHash: string;
  base_scene_card_version: number;
  parameters: StoryboardPreviewParameters;
  capability_snapshot_version: CapabilitySnapshotVersion;
  quotaCheck?: () => Promise<{ sufficient: boolean }>;
  canvasRecovery?: CanvasRecoveryAcceptance;
}

export type CreateStoryboardPreviewResult =
  | {
      kind: "applied";
      preview_id: string;
      scene_card_id: string;
      generation_job_id: string;
      cursor: string;
    }
  | {
      kind: "replayed";
      preview_id: string;
      scene_card_id: string;
      generation_job_id: string;
    }
  | { kind: "idempotency_conflict" }
  | { kind: "scene_card_not_found" }
  | { kind: "version_conflict"; current_scene_card_version: number }
  | { kind: "capability_drift" }
  | { kind: "capability_limit"; reason: string }
  | { kind: "quota_insufficient" }
  | { kind: "forbidden" };

function checkImageCapabilityLimit(
  parameters: StoryboardPreviewParameters,
  capability: {
    supported_sizes: unknown;
    supported_aspect_ratios: unknown;
    features: unknown;
  },
): string | null {
  const ratios = aspectRatioIds(capability.supported_aspect_ratios);
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
  const f = (capability.features ?? {}) as Record<string, unknown>;
  const quantityMax = Number(f.quantity_max ?? f.quantityMax ?? 1);
  if (parameters.count > quantityMax)
    return `count ${parameters.count} 超过 quantity_max ${quantityMax}`;
  return null;
}

async function createStoryboardPreviewInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateStoryboardPreviewInput,
): Promise<CreateStoryboardPreviewResult> {
  const projectId = BigInt(input.projectId);
  const userId = BigInt(input.userId);
  const sceneCardId = BigInt(input.sceneCardId);

  const project = await tx.project.findFirst({
    where: { id: projectId, owner_id: userId, is_delete: 0 },
    select: { id: true },
  });
  if (!project) return { kind: "forbidden" } as const;

  const existing = await tx.command_idempotency.findUnique({
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
      return { kind: "scene_card_not_found" } as const;
    return {
      kind: "replayed",
      preview_id: existing.resource_id.toString(),
      scene_card_id: sceneCardId.toString(),
      generation_job_id: existing.generation_job_id.toString(),
    };
  }

  const sceneCard = await tx.scene_cards.findFirst({
    where: { id: sceneCardId, project_id: projectId, is_delete: 0 },
    select: { id: true, content_markdown: true, version: true },
  });
  if (!sceneCard) return { kind: "scene_card_not_found" } as const;

  if (sceneCard.version !== input.base_scene_card_version) {
    return {
      kind: "version_conflict",
      current_scene_card_version: sceneCard.version,
    };
  }

  const snapshot = input.capability_snapshot_version;

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
      supported_sizes: true,
      supported_aspect_ratios: true,
      supported_durations: true,
      supported_formats: true,
      default_size: true,
      default_format: true,
      default_aspect_ratio: true,
      default_duration: true,
      features: true,
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

  const limitReason = checkImageCapabilityLimit(input.parameters, capability);
  if (limitReason) return { kind: "capability_limit", reason: limitReason };

  if (input.quotaCheck) {
    const quota = await input.quotaCheck();
    if (!quota.sufficient) return { kind: "quota_insufficient" } as const;
  }

  let recoveryPlan: CanvasRecoveryPlan | null = null;
  if (input.canvasRecovery) {
    const locked = await lockCanvasRecoveryForAcceptance(tx, input.canvasRecovery);
    if (locked.kind === "replay") {
      const winner = await tx.command_idempotency.findUnique({
        where: {
          project_id_operation_idempotency_key: {
            project_id: projectId,
            operation: OPERATION,
            idempotency_key: input.idempotencyKey,
          },
        },
        select: { resource_id: true },
      });
      if (!winner || winner.resource_id === null)
        return { kind: "scene_card_not_found" } as const;
      return {
        kind: "replayed",
        preview_id: winner.resource_id.toString(),
        scene_card_id: sceneCardId.toString(),
        generation_job_id: locked.result.generation_job_id,
      };
    }
    if (locked.kind === "idempotency_conflict") return { kind: "idempotency_conflict" };
    recoveryPlan = locked.plan;
  }


  const actionIdentity = createHash("sha256")
    .update(
      `${input.projectId}\0storyboard_preview\0${sceneCardId}\0${input.idempotencyKey}`,
    )
    .digest("hex");
  const createdJob = await createJobWithinTx(tx, {
    projectId: input.projectId,
    userId: input.userId,
    type: "image",
    expectedOutputCount: input.parameters.count,
    source: "storyboard_preview",
    actionIdentity,
    actionType: OPERATION,
    sceneCardId: sceneCardId.toString(),
    input: {
      prompt: sceneCard.content_markdown,
      model_id: input.parameters.model_id,
      size: input.parameters.size,
      aspect_ratio: input.parameters.aspect_ratio,
      web_search: false,
      sequential_image_generation: false,
      storyboard_preview: true,
      scene_card_id: sceneCardId.toString(),
    },
  });
  if ("kind" in createdJob) throw new Error("unreachable: storyboard job creation never conflicts idempotency");
  if (recoveryPlan) {
    await writeCanvasRecoveryRows(tx, recoveryPlan, BigInt(createdJob.generation_job_id));
  }

  const preview = await tx.storyboard_previews.create({
    data: {
      scene_card_id: sceneCardId,
      project_id: projectId,
      first_generation_job_id: BigInt(createdJob.generation_job_id),
      command_id: input.idempotencyKey,
      summary_status: "generating",
      capability_snapshot_version:
        input.capability_snapshot_version as unknown as Prisma.InputJsonValue,
    },
  });

  await tx.command_idempotency.create({
    data: {
      project_id: projectId,
      operation: OPERATION,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      generation_job_id: BigInt(createdJob.generation_job_id),
      resource_id: preview.id,
      accepted_cursor: BigInt(createdJob.cursor),
    },
  });

  const event = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "storyboard_preview.created",
    aggregateType: "storyboard_preview",
    aggregateId: preview.id.toString(),
    aggregateVersion: 1,
    correlationId: input.idempotencyKey,
    payload: {
      preview_id: preview.id.toString(),
      scene_card_id: sceneCardId.toString(),
      first_generation_job_id: createdJob.generation_job_id,
      summary_status: "generating",
    },
  });

  return {
    kind: "applied",
    preview_id: preview.id.toString(),
    scene_card_id: sceneCardId.toString(),
    generation_job_id: createdJob.generation_job_id,
    cursor: Math.max(createdJob.cursor, Number(event.cursor)).toString(),
  };
}

export async function validateStoryboardFrames(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  sceneCardId: bigint,
  frames: ReadonlyArray<
    Extract<ProviderPromptAsset, { type: "storyboard_frame" }>
  >,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (frames.length === 0) return { ok: true };
  const slotIds = frames.map((frame) => BigInt(frame.slot_id));
  const slots = await tx.generation_output_slots.findMany({
    where: { id: { in: slotIds } },
    select: { id: true, asset_id: true, status: true, generation_job_id: true },
  });
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const jobIds = Array.from(
    new Set(slots.map((slot) => slot.generation_job_id)),
  );
  const previews =
    jobIds.length === 0
      ? []
      : await tx.storyboard_previews.findMany({
          where: {
            first_generation_job_id: { in: jobIds },
            scene_card_id: sceneCardId,
            is_delete: 0,
          },
          select: { first_generation_job_id: true },
        });
  const previewJobIds = new Set(
    previews.map((preview) => preview.first_generation_job_id),
  );
  const assetIds = slots
    .map((slot) => slot.asset_id)
    .filter((id): id is bigint => id !== null);
  const assetSet = await findAccessibleAssetIds(tx, projectId, assetIds);
  for (const frame of frames) {
    const slot = slotById.get(BigInt(frame.slot_id));
    if (!slot) return { ok: false, reason: `画格 ${frame.slot_id} 不存在` };
    if (slot.status !== "succeeded" || slot.asset_id === null)
      return { ok: false, reason: `画格 ${frame.slot_id} 未成功` };
    if (!previewJobIds.has(slot.generation_job_id))
      return {
        ok: false,
        reason: `画格 ${frame.slot_id} 不属于该场景卡的分镜预览`,
      };
    if (!assetSet.has(slot.asset_id))
      return { ok: false, reason: `画格 ${frame.slot_id} 素材不可访问` };
  }
  return { ok: true };
}

async function findAccessibleAssetIds(
  client: Pick<Prisma.TransactionClient, "user_assets">,
  projectId: bigint,
  assetIds: bigint[],
): Promise<Set<bigint>> {
  if (assetIds.length === 0) return new Set();
  const assets = await client.user_assets.findMany({
    where: {
      id: { in: assetIds },
      project_id: projectId,
      status: "normal",
      is_delete: false,
    },
    select: { id: true },
  });
  return new Set(assets.map((asset) => asset.id));
}

export interface StoryboardPreviewView {
  preview_id: string;
  scene_card_id: string;
  first_generation_job_id: string;
  summary_status: string;
}

export type ListStoryboardPreviewsResult =
  | { kind: "found"; previews: StoryboardPreviewView[] }
  | { kind: "forbidden" };

export type ListStoryboardFramesResult =
  | { kind: "found"; frames: StoryboardFrameView[] }
  | { kind: "forbidden" };

export interface StoryboardPreviewRepo {
  createStoryboardPreview(
    input: CreateStoryboardPreviewInput,
  ): Promise<CreateStoryboardPreviewResult>;
  canvasBindingView(
    projectId: string,
    submissionId: string,
  ): Promise<CanvasBindingView | null>;
  listStoryboardPreviews(
    projectId: string,
    sceneCardId: string,
    userId: string,
  ): Promise<ListStoryboardPreviewsResult>;
  listStoryboardFrames(
    projectId: string,
    sceneCardId: string,
    userId: string,
  ): Promise<ListStoryboardFramesResult>;
}

export function createStoryboardPreviewRepo(
  prisma: PrismaClient,
): StoryboardPreviewRepo {
  return {
    createStoryboardPreview(input) {
      return transactionWithUniqueRetry(prisma, (tx) =>
        createStoryboardPreviewInTransaction(tx, input),
      );
    },
    canvasBindingView(projectId, submissionId) {
      return canvasBindingView(prisma, projectId, submissionId);
    },
    async listStoryboardPreviews(projectId, sceneCardId, userId) {
      const pid = BigInt(projectId);
      const uid = BigInt(userId);
      const sid = BigInt(sceneCardId);
      const project = await prisma.project.findFirst({
        where: { id: pid, owner_id: uid, is_delete: 0 },
        select: { id: true },
      });
      if (!project) return { kind: "forbidden" } as const;
      const rows = await prisma.storyboard_previews.findMany({
        where: { scene_card_id: sid, project_id: pid, is_delete: 0 },
        orderBy: { id: "asc" },
        select: {
          id: true,
          scene_card_id: true,
          first_generation_job_id: true,
          summary_status: true,
        },
      });
      return {
        kind: "found",
        previews: rows.map((row) => ({
          preview_id: row.id.toString(),
          scene_card_id: row.scene_card_id.toString(),
          first_generation_job_id: row.first_generation_job_id.toString(),
          summary_status: row.summary_status,
        })),
      };
    },
    async listStoryboardFrames(projectId, sceneCardId, userId) {
      const pid = BigInt(projectId);
      const uid = BigInt(userId);
      const sid = BigInt(sceneCardId);
      const project = await prisma.project.findFirst({
        where: { id: pid, owner_id: uid, is_delete: 0 },
        select: { id: true },
      });
      if (!project) return { kind: "forbidden" } as const;
      const previews = await prisma.storyboard_previews.findMany({
        where: { scene_card_id: sid, project_id: pid, is_delete: 0 },
        select: { first_generation_job_id: true },
      });
      const jobIds = previews.map((preview) => preview.first_generation_job_id);
      if (jobIds.length === 0) return { kind: "found", frames: [] };
      const slots = await prisma.generation_output_slots.findMany({
        where: {
          generation_job_id: { in: jobIds },
          status: "succeeded",
          asset_id: { not: null },
        },
        select: { id: true, asset_id: true, slot_index: true },
        orderBy: { slot_index: "asc" },
      });
      const assetIds = slots
        .map((slot) => slot.asset_id)
        .filter((id): id is bigint => id !== null);
      const assetSet = await findAccessibleAssetIds(prisma, pid, assetIds);
      const frames: StoryboardFrameView[] = slots
        .filter(
          (slot) => slot.asset_id !== null && assetSet.has(slot.asset_id),
        )
        .map((slot) => ({
          slot_id: slot.id.toString(),
          asset_id: slot.asset_id!.toString(),
          slot_index: slot.slot_index,
        }));
      return { kind: "found", frames };
    },
  };
}
