import { NewApiError } from "@lib/core";
import {
  DomainError,
  ERROR_TASK_TYPE_PARAM_CONSTRAINT,
  checkGenerationParamLimit,
  errorCodeToNumeric,
  hasModeConstraint,
  normalizeVideoMode,
  promptPlanSnapshotSchema,
  toGenerationParamCheckInput,
  type RecoveryErrorEnvelope,
  type VideoMode,
} from "@lib/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";

import { transactionWithUniqueRetry } from "./conversation-repo.js";
import {
  canvasBindingView,
  lockCanvasRecoveryForAcceptance,
  lockCanvasRecoveryForRetry,
  verifyRetryCanvasRecoveryLink,
  writeCanvasRecoveryRows,
  type CanvasBindingView,
  type CanvasRecoveryAcceptance,
  type CanvasRecoveryPlan,
} from "./generation-canvas-recovery-repo.js";
import { assertPureJobInput } from "./job-input-purity.js";
import {
  jobExistenceProbe,
  withBillingCompensation,
  type JobBilling,
  type JobBillingSource,
} from "./job-billing.js";
import { createModelCapabilityRepo, serializePricingRule } from "./model-capability-repo.js";
import { createAssetOwnershipOps } from "./asset-ownership-repo.js";
import { checkReferenceLimits } from "../generation-runtime/reference-limits.js";
import { freezePlacementAnchor } from "./generation-job-placement-anchor.js";
import {
  readCreateIdempotency,
  runWithCreateIdempotency,
  writeCreateIdempotency,
  type CreateJobIdempotency,
  type CreateJobResult,
} from "./generation-job-idempotency.js";
import {
  resolveLogicalSlots,
  type OutputSlotStatus,
} from "./generation-output-slot-repo.js";
import { nextSnowflake } from "./snowflake.js";
import {
  extraString,
  loadJobExtrasOne,
  setJobExtras,
} from "./generation-jobs-extra-repo.js";


export interface CreateJobInput {
  projectId: string;
  userId: string;
  type: "image" | "video" | "audio";
  expectedOutputCount: number;
  input: Record<string, unknown>;
  actionIdentity: string;
  actionType: string;
  source?: string;
  planMessageId?: string;
  sceneCardGenerationRecordId?: string;
  sceneCardId?: string;
  videoStage?: "sample";
  canvasRecovery?: CanvasRecoveryAcceptance;
}

export interface CreateJobOptions {
  callerTx?: Prisma.TransactionClient;
  billing?: JobBilling;
  idempotency?: CreateJobIdempotency;
}

export interface CreatedJob {
  generation_job_id: string;
  cursor: number;
}

export interface GenerationCommandRepo {
  createJob(
    input: CreateJobInput,
    options?: CreateJobOptions,
  ): Promise<CreateJobResult>;
  lookupCreateIdempotency(
    projectId: string,
    idempotency: CreateJobIdempotency,
  ): Promise<CreateJobResult | null>;
  requestCancel(jobId: string, userId: string): Promise<CancelOutcome>;
  retryJob(
    originalJobId: string,
    projectId: string,
    userId: string,
    idempotencyKey: string,
    requestHash: string,
    guardInput?: (
      input: Record<string, unknown>,
      jobType: string,
    ) => Promise<string | null>,
    canvasRecovery?: CanvasRecoveryAcceptance,
    billing?: JobBillingSource,
  ): Promise<
    | (CreatedJob & { type: "image" | "video" | "audio" })
    | { kind: "idempotency_conflict" }
    | { kind: "material_blocked"; reason: string }
    | { kind: "not_retryable_status" }
    | { kind: "already_retried" }
    | { kind: "finalize_retry_closed" }
    | { kind: "recovery_contract_error"; envelope: RecoveryErrorEnvelope }
    | null
  >;
  canvasBindingView(projectId: string, submissionId: string): Promise<CanvasBindingView | null>;
  appendLog(
    jobId: string,
    event: string,
    status: string | null,
    message?: string,
    payload?: unknown,
  ): Promise<void>;
  markFailedQueued(
    jobId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<boolean>;
}

export type CancelOutcome = "cancelled" | "not_found" | "not_cancelable";

export const SOURCE_BOTTOM_DOCK = "bottom_dock";

export const VIDEO_STRATEGY_VERSION = "seedance-2.0-v1";

export function strategyVersionOf(type: string): string {
  return type === "video"
    ? VIDEO_STRATEGY_VERSION
    : type === "audio"
      ? "audio-sync-v1"
      : "image-sync-v1";
}

export function readInputCount(input: Prisma.JsonValue | null): number {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return 1;
  const n = Number((input as Record<string, unknown>).expected_output_count);
  return Number.isInteger(n) && n > 0 ? n : 1;
}


interface LegacyReservationCarryOver {
  reserved_amount_fen: bigint;
  price_catalog_version: string;
  exchange_rate_version: string;
  model_policy_version: string;
  cost_rule_version: string;
}

function costReservationCreateData(
  carryOver: LegacyReservationCarryOver | null,
  jobId: bigint,
  userId: string,
  projectId: string,
  input: CreateJobInput,
): Prisma.billing_cost_reservationsCreateArgs["data"] {
  return {
    generation_job_id: jobId,
    user_id: BigInt(userId),
    project_id: BigInt(projectId),
    action_identity: input.actionIdentity,
    action_type: input.actionType,
    provider: "volc",
    reserved_amount_fen: carryOver?.reserved_amount_fen ?? 0n,
    status: "reserved",
    price_catalog_version: carryOver?.price_catalog_version ?? "dev",
    exchange_rate_version: carryOver?.exchange_rate_version ?? "dev",
    model_policy_version: carryOver?.model_policy_version ?? "dev",
    cost_rule_version: carryOver?.cost_rule_version ?? "dev",
  };
}

export async function createJobWithinTx(
  tx: Prisma.TransactionClient,
  input: CreateJobInput,
  billing?: JobBilling,
  idempotency?: CreateJobIdempotency,
): Promise<CreateJobResult> {
  assertPureJobInput(input);
  let recoveryPlan: CanvasRecoveryPlan | null = null;
  if (input.canvasRecovery) {
    const locked = await lockCanvasRecoveryForAcceptance(tx, input.canvasRecovery);
    if (locked.kind === "replay") return locked.result;
    if (locked.kind === "idempotency_conflict") return { kind: "idempotency_conflict" };
    recoveryPlan = locked.plan;
  }
  if (input.input.prompt_plan_snapshot !== undefined) {
    const snapshot = promptPlanSnapshotSchema.parse(input.input.prompt_plan_snapshot);
    const rows = await tx.$queryRaw<Array<{ version: number }>>`SELECT version FROM project_canvas WHERE project_id = ${BigInt(input.projectId)} FOR UPDATE`;
    if (rows[0]?.version !== snapshot.canvasVersion) throw new NewApiError("Canvas 版本冲突，请保存后重新提交", 412);
    for (const image of [...snapshot.images.map(i => ({ ...i, type: "image", providerUrl: i.url })), ...(snapshot.videoReferences ?? [])].filter((ref): ref is typeof ref & { assetId: string } => Boolean(ref.assetId)).sort((a, b) => a.assetId.localeCompare(b.assetId))) {
      const assets = await tx.$queryRaw<Array<{ id: bigint; project_id: bigint; material_id: string | null }>>`SELECT id, project_id, material_id FROM user_assets WHERE id = ${BigInt(image.assetId)} AND user_id = ${BigInt(input.userId)} AND is_delete = false AND status = 'normal' AND type = ${image.type} AND url = ${image.url} FOR UPDATE`;
      const asset = assets[0];
      const links = asset && asset.project_id !== 0n && asset.project_id !== BigInt(input.projectId)
        ? await tx.$queryRaw<Array<{ asset_id: bigint }>>`SELECT asset_id FROM project_asset WHERE asset_id = ${BigInt(image.assetId)} AND project_id = ${BigInt(input.projectId)} AND user_id = ${BigInt(input.userId)} AND is_delete = 0 FOR UPDATE`
        : undefined;
      if (!asset || (links && links.length === 0) || (snapshot.videoReferences && (asset.material_id ? `asset://${asset.material_id}` : image.url) !== image.providerUrl)) {
        const indices = snapshot.plans.flatMap(p => p.mentions.filter(m => m.assetId === image.assetId).map(m => `#${m.index}`));
        throw new NewApiError(`素材索引 ${indices.join("、")} 已变化或不可用，请重新提交`, 400);
      }
    }
  }
  const now = new Date();
  const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const frozenInput = await freezePlacementAnchor(tx, input);
  const jobInput = { ...frozenInput, expected_output_count: input.expectedOutputCount };
  const job = await tx.generation_jobs.create({
    data: {
      project_id: BigInt(input.projectId),
      user_id: BigInt(input.userId),
      type: input.type,
      source: input.source ?? SOURCE_BOTTOM_DOCK,
      status: "queued",
      progress: 0,
      input: jobInput as never,
      execution_deadline_at: deadline,
      next_action_at: now,
      fencing_token: 0,
    },
  });
  await setJobExtras(tx, job.id, {
    strategy_version: strategyVersionOf(input.type),
    ...(input.videoStage !== undefined
      ? { video_stage: input.videoStage, charge_state: "charged" }
      : {}),
  });
  if (billing) {
    await billing.charge(Number(job.id));
  }

  if (input.expectedOutputCount > 0) {
    for (let i = 0; i < input.expectedOutputCount; i += 1) {
      await tx.generation_output_slots.create({
        data: {
          project_id: BigInt(input.projectId),
          generation_job_id: job.id,
          ...(input.sceneCardGenerationRecordId
            ? {
                scene_card_generation_record_id: BigInt(
                  input.sceneCardGenerationRecordId,
                ),
              }
            : {}),
          slot_index: i,
          status: "pending",
        },
      });
    }
  }
  await tx.billing_cost_reservations.create({
    data: costReservationCreateData(
      null,
      job.id,
      input.userId,
      input.projectId,
      input,
    ),
  });
  await tx.generation_job_logs.create({
    data: {
      generation_job_id: job.id,
      event: "created",
      status: "queued",
      message: "任务已创建",
      payload: {
        input,
        ...(input.planMessageId
          ? { plan_message_id: input.planMessageId }
          : {}),
      },
    } as never,
  });
  const cursor = nextSnowflake();
  await writeCreateIdempotency(
    tx,
    { projectId: input.projectId, jobId: job.id, acceptedCursor: cursor.toString() },
    idempotency,
  );
  if (recoveryPlan) await writeCanvasRecoveryRows(tx, recoveryPlan, job.id);
  return {
    generation_job_id: job.id.toString(),
    cursor: Number(cursor),
  };
}

export function createGenerationCommandRepo(
  prisma: PrismaClient,
): GenerationCommandRepo {
  const compensate = <T>(
    billing: JobBilling | undefined,
    run: (billing: JobBilling | undefined) => Promise<T>,
  ): Promise<T> =>
    withBillingCompensation(billing, run, jobExistenceProbe(prisma));
  return {
    async createJob(input, options) {
      const idempotency = options?.idempotency;
      const run = () =>
        compensate(
          options?.billing,
          (billing) =>
            options?.callerTx
              ? createJobWithinTx(options.callerTx, input, billing, idempotency)
              : prisma.$transaction(
                  (tx) => createJobWithinTx(tx, input, billing, idempotency),
                  { maxWait: 10_000, timeout: 30_000 },
                ),
        );
      return options?.callerTx
        ? run()
        : runWithCreateIdempotency(prisma, input.projectId, idempotency, run);
    },

    lookupCreateIdempotency(projectId, idempotency) {
      return readCreateIdempotency(prisma, projectId, idempotency);
    },

    async requestCancel(jobId, userId) {
      const updated = await prisma.generation_jobs.updateMany({
        where: {
          id: BigInt(jobId),
          user_id: BigInt(userId),
          is_delete: false,
          status: "queued",
        },
        data: { cancel_requested_at: new Date(), next_action_at: new Date() },
      });
      if (updated.count !== 1) {
        const exists = await prisma.generation_jobs.findFirst({
          where: { id: BigInt(jobId), user_id: BigInt(userId), is_delete: false },
          select: { status: true },
        });
        return exists ? "not_cancelable" : "not_found";
      }
      await this.appendLog(
        jobId,
        "cancel_requested",
        "queued",
        "用户请求取消",
      );
      return "cancelled";
    },

    retryJob(
      originalJobId,
      projectId,
      userId,
      idempotencyKey,
      requestHash,
      guardInput,
      canvasRecovery,
      billing,
    ) {
      let chargeContext: {
        commandId: string;
        modelId: string;
        taskType: string;
        input: Record<string, unknown>;
        ruleSnapshot?: string;
      } | null = null;
      const jobBilling: JobBilling | undefined = billing
        ? {
            charge: async (jobId) => {
              if (chargeContext === null) {
                throw new Error("retry billing context 未初始化");
              }
              await billing.charge({
                userId,
                jobId,
                commandId: chargeContext.commandId,
                modelId: chargeContext.modelId,
                taskType: chargeContext.taskType,
                input: chargeContext.input,
                ...(chargeContext.ruleSnapshot !== undefined
                  ? { ruleSnapshot: chargeContext.ruleSnapshot }
                  : {}),
              });
            },
            release: (jobId, reason) =>
              billing.release({ userId, jobId, reason }),
          }
        : undefined;
      return compensate(jobBilling, (billing) =>
        transactionWithUniqueRetry(
        prisma,
        async (tx) => {
        const pid = BigInt(projectId);
        let recoveryPlan: CanvasRecoveryPlan | null = null;
        if (canvasRecovery) {
          const rejected = await verifyRetryCanvasRecoveryLink(tx, projectId, originalJobId, canvasRecovery.binding.target_node_id);
          if (rejected) return { kind: "recovery_contract_error", envelope: rejected } as const;
        }
        const original = await tx.generation_jobs.findFirst({
          where: {
            id: BigInt(originalJobId),
            project_id: pid,
            user_id: BigInt(userId),
            is_delete: false,
          },
        });
        if (!original) return null;
        const originalExtras = await loadJobExtrasOne(tx, original.id.toString());
        if (extraString(originalExtras, "video_stage") === "final") {
          return { kind: "finalize_retry_closed" } as const;
        }
        if (
          original.status !== "failed" &&
          original.status !== "partially_succeeded"
        ) {
          return { kind: "not_retryable_status" } as const;
        }

        const operation = "generation.retry";
        const existing = idempotencyKey
          ? await tx.project_command_receipts.findUnique({
              where: {
                project_id_operation_idempotency_key: {
                  project_id: pid,
                  operation,
                  idempotency_key: idempotencyKey,
                },
              },
              select: {
                request_hash: true,
                generation_job_id: true,
                accepted_cursor: true,
              },
            })
          : null;
        if (existing) {
          if (existing.request_hash !== requestHash) {
            return { kind: "idempotency_conflict" } as const;
          }
          return {
            generation_job_id: String(existing.generation_job_id),
            cursor: Number(existing.accepted_cursor),
            type: original.type as "image" | "video" | "audio",
          };
        }

        const allProjectSlots = await tx.generation_output_slots.findMany({
          where: { project_id: pid },
          orderBy: { id: "asc" },
        });
        const originalSlotIds = new Set(
          allProjectSlots
            .filter((slot) => slot.generation_job_id === original.id)
            .map((slot) => slot.id),
        );
        const retrySlotsByParent = new Map<
          bigint,
          Array<(typeof allProjectSlots)[number]>
        >();
        for (const slot of allProjectSlots) {
          if (slot.retry_of_slot_id === null) continue;
          const children = retrySlotsByParent.get(slot.retry_of_slot_id) ?? [];
          children.push(slot);
          retrySlotsByParent.set(slot.retry_of_slot_id, children);
        }
        const chainSlotIds = new Set(originalSlotIds);
        const pendingParents = [...originalSlotIds];
        for (let index = 0; index < pendingParents.length; index += 1) {
          for (const child of retrySlotsByParent.get(pendingParents[index]!) ??
            []) {
            if (!chainSlotIds.has(child.id)) {
              chainSlotIds.add(child.id);
              pendingParents.push(child.id);
            }
          }
        }
        const trackedSlots = allProjectSlots.filter((slot) =>
          chainSlotIds.has(slot.id),
        );
        const failedSlots = resolveLogicalSlots(
          trackedSlots.map((slot) => ({
            ...slot,
            status: slot.status as OutputSlotStatus,
          })),
        ).filter(
          (slot) => slot.status === "failed" || slot.status === "missing",
        );
        if (originalSlotIds.size > 0 && failedSlots.length === 0) {
          return { kind: "already_retried" } as const;
        }
        const retryCount =
          originalSlotIds.size > 0
            ? failedSlots.length
            : readInputCount(original.input);

        const input = (original.input ?? {}) as Record<string, unknown>;
        const sceneParameters = original.source === "scene_card" &&
          typeof input.parameters === "object" && input.parameters !== null && !Array.isArray(input.parameters)
          ? input.parameters : null;
        const retryParameters: Record<string, unknown> = sceneParameters ? { ...sceneParameters, ...input } : input;
        const capability = original.type === "video" || billing
          ? (await createModelCapabilityRepo(prisma).listEnabledByType(original.type))
              .find((model) => model.model_id === retryParameters.model_id)
          : undefined;
        if (original.type === "video") {
          const params = toGenerationParamCheckInput(retryParameters);
          const references = (input.references ?? input.reference_materials ?? []) as Array<{
            role?: string; type: "image" | "video" | "audio"; duration?: number;
          }>;
          const localReferences = Array.isArray(input.reference_asset_ids)
            ? await createAssetOwnershipOps(prisma).resolveInputAssets(input.reference_asset_ids.map(String), userId, projectId)
            : [];
          const ordinaryReferences = [
            ...references.filter((reference) => reference.role === undefined || reference.role === "reference"),
            ...localReferences.flatMap<(typeof references)[number]>((asset) => asset.type === "image" || asset.type === "video" || asset.type === "audio"
              ? [{ type: asset.type, ...(asset.duration !== null ? { duration: asset.duration } : {}) }]
              : []),
          ];
          let legacySceneMode: VideoMode | null = null;
          if (sceneParameters &&
            input.video_mode === undefined && input.video_task_type === undefined &&
            input.omni_reference_task_type_allowed === undefined &&
            ordinaryReferences.every((reference) => reference.type === "image")) {
            if (input.reference_mode === "first_and_last_frame" && input.first_frame_asset_id && input.last_frame_asset_id && ordinaryReferences.length === 0) {
              legacySceneMode = "first_last_frame";
            } else if (input.reference_mode === "first_frame" && input.first_frame_asset_id && !input.last_frame_asset_id && ordinaryReferences.length === 0) {
              legacySceneMode = "first_frame";
            } else if (input.reference_mode === "text_to_video" && !input.first_frame_asset_id && !input.last_frame_asset_id) {
              legacySceneMode = ordinaryReferences.length > 0 ? "image_reference" : "text2video";
            }
          }
          const mode = normalizeVideoMode(input.video_mode ?? input.video_task_type) ?? legacySceneMode;
          if (
            !capability || !mode || !params || params.duration === undefined ||
            (!legacySceneMode && (typeof input.omni_reference_task_type_allowed !== "boolean" ||
              input.omni_reference_task_type_allowed !== capability.features.omni_reference_task_type)) ||
            !hasModeConstraint(capability.features.task_types, mode) ||
            checkGenerationParamLimit({ ...capability, task_types: capability.features.task_types }, { ...params, mode }) ||
            checkReferenceLimits(capability.features, ordinaryReferences, "video", mode)
          ) {
            throw new DomainError(
              errorCodeToNumeric(ERROR_TASK_TYPE_PARAM_CONSTRAINT),
              "原视频任务的模式或参数已不满足当前模型要求，请重新编辑，确认视频模式和时长后重新报价提交",
            );
          }
        }

        if (guardInput) {
          const reason = await guardInput(
            (original.input ?? {}) as Record<string, unknown>,
            original.type,
          );
          if (reason !== null) return { kind: "material_blocked", reason } as const;
        }

        if (canvasRecovery) {
          const locked = await lockCanvasRecoveryForRetry(tx, { ...canvasRecovery, taskType: original.type });
          if (locked.kind === "replay") {
            return { generation_job_id: locked.result.generation_job_id, cursor: locked.result.cursor, type: original.type as "image" | "video" | "audio" };
          }
          if (locked.kind === "idempotency_conflict") return { kind: "idempotency_conflict" } as const;
          if (locked.kind === "error") return { kind: "recovery_contract_error", envelope: locked.envelope } as const;
          recoveryPlan = locked.plan;
        }

        const now = new Date();
        const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const retry = await tx.generation_jobs.create({
          data: {
            project_id: pid,
            user_id: original.user_id,
            type: original.type,
            source: original.source,
            status: "queued",
            progress: 0,
            input: original.input as never,
            retry_of_job_id: original.id,
            execution_deadline_at: deadline,
            next_action_at: now,
            fencing_token: 0,
          },
        });
        const inheritedStage = extraString(originalExtras, "video_stage");
        await setJobExtras(tx, retry.id, {
          strategy_version:
            extraString(originalExtras, "strategy_version") ??
            strategyVersionOf(original.type),
          ...(inheritedStage !== null ? { video_stage: inheritedStage } : {}),
        });
        const retryInput: CreateJobInput = {
          projectId,
          userId: original.user_id.toString(),
          type: original.type as "image" | "video" | "audio",
          expectedOutputCount: retryCount,
          input: (original.input ?? {}) as Record<string, unknown>,
          actionIdentity: idempotencyKey || `retry:${originalJobId}`,
          actionType:
            original.type === "video"
              ? "generate_video"
              : original.type === "audio"
                ? "generate_audio"
                : "generate_image",
        };
        const retryModelId = String(retryParameters.model_id ?? "");
        let ruleSnapshot: string | undefined;
        if (billing) {
          ruleSnapshot = serializePricingRule(capability);
        }
        chargeContext = {
          commandId: retryInput.actionIdentity,
          modelId: retryModelId,
          taskType: original.type,
          input: retryParameters,
          ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
        };
        if (billing) {
          await billing.charge(Number(retry.id));
        }
        if (failedSlots.length > 0) {
          const recordIds = new Set<bigint>();
          for (const orig of failedSlots) {
            await tx.generation_output_slots.create({
              data: {
                project_id: pid,
                generation_job_id: retry.id,
                ...(orig.scene_card_generation_record_id
                  ? {
                      scene_card_generation_record_id:
                        orig.scene_card_generation_record_id,
                    }
                  : {}),
                slot_index: orig.slot_index,
                status: "pending",
                retry_of_slot_id: orig.id,
              },
            });
            if (orig.scene_card_generation_record_id) {
              recordIds.add(orig.scene_card_generation_record_id);
            }
          }
          for (const recordId of recordIds) {
            await tx.scene_card_generation_records.update({
              where: { id: recordId },
              data: {
                summary_status: "generating",
                version: { increment: 1 },
              },
            });
          }
        } else {
          for (let i = 0; i < retryCount; i += 1) {
            await tx.generation_output_slots.create({
              data: {
                project_id: pid,
                generation_job_id: retry.id,
                slot_index: i,
                status: "pending",
              },
            });
          }
        }
        const cursor = nextSnowflake();
        if (idempotencyKey) {
          await tx.project_command_receipts.create({
            data: {
              project_id: pid,
              operation,
              idempotency_key: idempotencyKey,
              request_hash: requestHash,
              generation_job_id: retry.id,
              resource_id: BigInt(originalJobId),
              accepted_cursor: cursor,
            },
          });
        }
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: retry.id,
            event: "retry_created",
            status: "queued",
            message: `重试 ${originalJobId}`,
          },
        });
        if (recoveryPlan) await writeCanvasRecoveryRows(tx, recoveryPlan, retry.id);
        return {
          generation_job_id: retry.id.toString(),
          cursor: Number(cursor),
          type: original.type as "image" | "video" | "audio",
        };
        },
        { maxWait: 10_000, timeout: 30_000 },
      ),
      );
    },

    canvasBindingView(projectId, submissionId) {
      return canvasBindingView(prisma, projectId, submissionId);
    },

    async appendLog(jobId, event, status, message, payload) {
      const data: Record<string, unknown> = {
        generation_job_id: BigInt(jobId),
        event,
        status,
      };
      if (message !== undefined) data.message = message;
      if (payload !== undefined) data.payload = payload as never;
      await prisma.generation_job_logs.create({ data: data as never });
    },

    async markFailedQueued(jobId, code, message, details) {
      const error: Record<string, unknown> = { code, message };
      if (details !== undefined) error.details = details;
      return prisma.$transaction(async (tx) => {
        const id = BigInt(jobId);
        const result = await tx.generation_jobs.updateMany({
          where: { id, status: "queued" },
          data: {
            status: "failed",
            error: error as Prisma.InputJsonValue,
            next_action_at: null,
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) return false;
        const job = await tx.generation_jobs.findUniqueOrThrow({
          where: { id },
          select: { user_id: true },
        });
        await tx.generation_outbox.create({
          data: {
            job_id: id,
            user_id: job.user_id,
            terminal_status: "failed",
            reason: message,
          },
        });
        return true;
      });
    },
  };
}
