import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CapabilitySnapshotVersion,
  ProviderPromptAsset,
  StoryboardFrameView,
  StoryboardPreviewParameters,
} from "@lib/contracts";
import type { CostReservationSnapshot } from "@lib/core";

import { createJobWithinTx } from "./generation-command-repo.js";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import { appendProjectEvent } from "./product-event-repo.js";
import { transactionWithUniqueRetry } from "./conversation-repo.js";

const OPERATION = "scene_card.storyboard_preview";

/** StoryboardPreview 创建入参（CONTEXT L43-47）：User 从 SceneCard 显式触发的旁路操作。
 *  idempotencyKey 即 CommandId（Idempotency-Key header）；requestHash 由 handler 按 method/path/body 计算。
 *  base_scene_card_version 用于乐观并发；parameters 为本次画格参数快照。 */
export interface CreateStoryboardPreviewInput {
  userId: string;
  projectId: string;
  sceneCardId: string;
  idempotencyKey: string;
  requestHash: string;
  base_scene_card_version: number;
  parameters: StoryboardPreviewParameters;
  capability_snapshot_version: CapabilitySnapshotVersion;
  /** 明文供应商 sk token（修正四：去密，与图片计划应用一致）；worker 直接取用调网关。 */
  provider_credential?: string;
  /** 余额预检回调（与 plan apply 图片分支一致）；缺失视为不检查。 */
  quotaCheck?: () => Promise<{ sufficient: boolean }>;
  /** IK7G9X：建首 job 时的记账快照（真实预估金额 + 定价口径版本）。 */
  costReservation?: CostReservationSnapshot;
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

/** 图片能力上限校验（AC#1 能力约束）：当前图片能力无统一 checker，这里按 features.quantity_max
 *  校验 count，并校验 size / aspect_ratio 在支持范围内。未知能力按不支持处理。 */
function checkImageCapabilityLimit(
  parameters: StoryboardPreviewParameters,
  capability: {
    supported_sizes: unknown;
    supported_aspect_ratios: unknown;
    features: unknown;
  },
): string | null {
  const ratios = Array.isArray(capability.supported_aspect_ratios)
    ? capability.supported_aspect_ratios
    : [];
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

/** 单事务原子创建（AC#2 零副作用前置 / AC#6 恢复）：前置检查全部通过才建 image job + 预览行 + 事件。
 *  任一前置失败零写入；同 CommandId 重放首次结果；版本冲突零写入。 */
async function createStoryboardPreviewInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateStoryboardPreviewInput,
): Promise<CreateStoryboardPreviewResult> {
  const projectId = BigInt(input.projectId);
  const userId = BigInt(input.userId);
  const sceneCardId = BigInt(input.sceneCardId);

  // 0. 前置授权：校验项目归属当前用户，不泄漏存在性。
  const project = await tx.project.findFirst({
    where: { id: projectId, owner_id: userId, is_delete: 0 },
    select: { id: true },
  });
  if (!project) return { kind: "forbidden" } as const;

  // 1. CommandId 幂等：命中则比对 request_hash，相同重放首次结果，不同冲突。
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

  // 2. 读 SceneCard（校验项目归属 + 未删除）。
  const sceneCard = await tx.scene_cards.findFirst({
    where: { id: sceneCardId, project_id: projectId, is_delete: 0 },
    select: { id: true, content_markdown: true, version: true },
  });
  if (!sceneCard) return { kind: "scene_card_not_found" } as const;

  // 3. 版本冲突（AC#6 乐观并发）：base 版本与当前不一致零写入。
  if (sceneCard.version !== input.base_scene_card_version) {
    return {
      kind: "version_conflict",
      current_scene_card_version: sceneCard.version,
    };
  }

  const snapshot = input.capability_snapshot_version;

  // 4. 能力漂移检测（AC#4）：按提交的 model_id/provider_id 查当前 image 行，比对 row_version + digest。
  //    digest 与 model-capability-repo / agent-run 冻结同源（全 8 字段），客户端从能力端点拿 digest。
  const capability = await tx.generation_model_capability.findUnique({
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

  // 5. 图片能力上限（AC#1）：count/size/aspect_ratio 必须在当前能力支持范围内。
  const limitReason = checkImageCapabilityLimit(input.parameters, capability);
  if (limitReason) return { kind: "capability_limit", reason: limitReason };

  // 6. 余额预检（与 plan apply 图片分支一致）：不足零写入。
  if (input.quotaCheck) {
    const quota = await input.quotaCheck();
    if (!quota.sufficient) return { kind: "quota_insufficient" } as const;
  }

  // === 前置检查全部通过，开始原子写入（AC#2 不碰 Preset / 不切媒体类型）===

  // 7. 创建 image GenerationJob（source=storyboard_preview，expected_output_count=count）。
  //    画格 = 其 N 个 output_slot（按 slot_index 升序 = 镜头顺序）；不设 scene_card_generation_record_id（图片路径）。
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
      provider_credential: input.provider_credential,
      web_search: false,
      sequential_image_generation: false,
      storyboard_preview: true,
      scene_card_id: sceneCardId.toString(),
    },
    ...(input.costReservation ? { costReservation: input.costReservation } : {}),
  });

  // 8. INSERT storyboard_previews（聚合根 + SceneCard 绑定；summary_status=generating）。
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

  // 9. INSERT command_idempotency（operation=scene_card.storyboard_preview，resource_id=preview_id）。
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

  // 10. project_events：storyboard_preview.created（同 tx，AC#6 恢复）。
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

/** IK70LQ：画格角色绑定前置校验（CONTEXT L53-57）。逐个确认 submitted 画格属于本 SceneCard 的
 *  StoryboardPreview（同 scene_card）、slot 已 succeeded、Asset 可访问（同 project、status=normal、
 *  is_delete=false）。画格无 mention_id，不走 validateDerivedReferences，在 mention 组校验前单独成组调用。
 *  任一不满足 → validation_failed 零写入。 */
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
  // 限定同 scene_card：只接受其 job 属于本 SceneCard 的 StoryboardPreview 的画格。
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

/** 查可访问 Asset（本项目、normal、未删除）的 id 集合——画格前置校验与画格列表共用同一过滤口径。 */
async function findAccessibleAssetIds(
  client: Pick<Prisma.TransactionClient, "assets">,
  projectId: bigint,
  assetIds: bigint[],
): Promise<Set<bigint>> {
  if (assetIds.length === 0) return new Set();
  const assets = await client.assets.findMany({
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
  /** GET 只读端点：返回某 SceneCard 下所有未删除预览（按 id 升序）。 */
  listStoryboardPreviews(
    projectId: string,
    sceneCardId: string,
    userId: string,
  ): Promise<ListStoryboardPreviewsResult>;
  /** IK70LQ：编辑器画格候选——返回该 SceneCard 下 succeeded 且 Asset 可访问的画格（slot_index 升序）。 */
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
