import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import {
  ASSET_UNAVAILABLE_CODE,
  CANVAS_RECOVERY_PROTOCOL_VERSION,
  FAILURE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_SCENE_SPLIT_INPUT_KEYS,
  VIDEO_SCENE_SPLIT_JOB_TYPE,
  VIDEO_SCENE_SPLIT_MAX_DURATION_MS,
  VIDEO_SCENE_SPLIT_SOURCE,
  canvasBindingSchema,
  fail,
  ok,
  videoSceneSplitInputSchema,
  type CanvasBinding,
  type VideoSceneSplitInput,
} from "@lib/contracts";
import {
  readAcceptedMediaToolReplay,
  renderMediaToolReplay,
} from "@lib/shared/generation/media-tool-recovery.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import {
  RecoveryContractError,
  canvasBindingView,
  lockCanvasRecoveryForAcceptance,
  writeCanvasRecoveryRows,
  type CanvasRecoveryAcceptance,
  type CanvasRecoveryPlan,
} from "@lib/shared/persistence/index.js";
import { withBillingCompensation } from "@lib/shared/persistence/job-billing.js";
import { transactionWithUniqueRetry } from "@lib/shared/persistence/conversation-repo.js";
import { enqueueVideoSceneSplitJob } from "@lib/shared/generation/generation-queue.js";
import {
  enqueueMediaToolJob,
} from "@lib/shared/media-tools/media-tool-submission.js";
import { resolveSourceDuration } from "@lib/shared/media-tools/source-duration.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

const IDEMPOTENCY_OPERATION = "video_scene_split.create";

const CLIENT_TOKEN_PATTERN = /^[\x20-\x7E]{1,64}$/;

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [VIDEO_SCENE_SPLIT_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [VIDEO_SCENE_SPLIT_INPUT_KEYS.granularity]: "切分粒度仅支持 fine / standard / coarse",
};

function readableParseError(
  issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[],
): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许场景切分任务的 source_asset_id / target_node_id / granularity / client_token 键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

function requestHashOf(projectId: string, input: VideoSceneSplitInput, canvasBinding?: CanvasBinding | null): string {
  return createHash("sha256")
    .update(
      `POST:/api/projects/${projectId}/video-scene-splits` +
        `:${input[VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId]}` +
        `\0${input[VIDEO_SCENE_SPLIT_INPUT_KEYS.targetNodeId]}` +
        `\0${input[VIDEO_SCENE_SPLIT_INPUT_KEYS.granularity]}` +
        (canvasBinding ? `\0${JSON.stringify(canvasBinding)}` : ""),
    )
    .digest("hex");
}

@Injectable()
export class VideoSceneSplitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
    private readonly storage: AssetStorageService,
    private readonly billing: MediaToolBillingService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
  ) {
    const { client_token: clientToken, canvas_binding: canvasBindingBody, ...businessBody } = body ?? {};
    if (typeof clientToken !== "string" || !CLIENT_TOKEN_PATTERN.test(clientToken)) {
      return fail(PARAM_MISSING_CODE, "缺少或非法的 client_token（幂等键，≤64 位可打印 ASCII、大小写敏感）");
    }

    let canvasBinding: CanvasBinding | null = null;
    if (canvasBindingBody !== undefined && canvasBindingBody !== null) {
      const parsedBinding = canvasBindingSchema.safeParse(canvasBindingBody);
      if (!parsedBinding.success) {
        return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
      }
      canvasBinding = parsedBinding.data;
      if (clientToken !== canvasBinding.submission_id) {
        return fail(400, "client_token 必须等于 canvas_binding.submission_id", {
          reason: RECOVERY_REASONS.invalidPayload,
        });
      }
    }

    const parsed = videoSceneSplitInputSchema.safeParse(businessBody);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoSceneSplitInput = parsed.data;
    const requestHash = requestHashOf(projectId, input, canvasBinding);

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    let replay: Awaited<ReturnType<typeof readAcceptedMediaToolReplay>> | null;
    try {
      replay = canvasBinding
        ? await readAcceptedMediaToolReplay(this.prisma.client, {
            projectId,
            userId,
            taskType: VIDEO_SCENE_SPLIT_JOB_TYPE,
            operation: IDEMPOTENCY_OPERATION,
            requestHash,
            binding: canvasBinding,
          })
        : await readAcceptedMediaToolReplay(this.prisma.client, {
            projectId,
            operation: IDEMPOTENCY_OPERATION,
            requestHash,
            key: clientToken,
          });
    } catch (error) {
      logger.warn(
        `[video-scene-split] 幂等预检失败，回落到事务内校验：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      replay = null;
    }
    if (replay) {
      return renderMediaToolReplay(replay, () =>
        fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）"),
      );
    }

    const asset = await this.assets.findOwnedSource(
      input[VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持对视频资产发起场景切分");
    }

    const duration = await resolveSourceDuration({
      prisma: this.prisma.client,
      storage: this.storage,
      asset: {
        id: input[VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId],
        storage_key: asset.storage_key,
        duration_ms: asset.duration_ms,
      },
    });
    if (duration === null) {
      return fail(
        ASSET_UNAVAILABLE_CODE,
        "源视频时长读取失败，请稍后重试或更换素材",
        { code: "asset_unavailable" },
      );
    }
    if (duration.durationMs > VIDEO_SCENE_SPLIT_MAX_DURATION_MS) {
      return fail(FAILURE_CODE, "暂支持 2 小时以内的视频场景切分");
    }

    const frozenInput = { ...input, duration: duration.seconds } as Prisma.InputJsonObject;
    const jobBilling = await this.billing.jobBilling(
      VIDEO_SCENE_SPLIT_JOB_TYPE,
      userId,
      frozenInput,
    );

    let createdJobId: string | null = null;
    let committed = false;
    let callbackCompleted = false;
    try {
      const result = await transactionWithUniqueRetry(this.prisma.client, async (tx) => {
      createdJobId = null;
      callbackCompleted = false;
      let recoveryPlan: CanvasRecoveryPlan | null = null;
      if (canvasBinding) {
        const acceptance: CanvasRecoveryAcceptance = {
          projectId,
          userId,
          binding: canvasBinding,
          operation: IDEMPOTENCY_OPERATION,
          requestHash,
          idempotencyKey: clientToken,
          taskType: VIDEO_SCENE_SPLIT_JOB_TYPE,
        };
        const locked = await lockCanvasRecoveryForAcceptance(tx, acceptance);
        if (locked.kind === "replay") {
          const replayed = await tx.generation_jobs.findUnique({
            where: { id: BigInt(locked.result.generation_job_id) },
            select: { status: true },
          });
          return ok({
            job_id: locked.result.generation_job_id,
            status: replayed?.status ?? "queued",
            canvas_binding: await canvasBindingView(
              this.prisma.client, projectId, canvasBinding.submission_id,
            ),
          });
        }
        if (locked.kind === "idempotency_conflict") {
          return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
        }
        recoveryPlan = locked.plan;
      } else {
        const existing = await tx.command_idempotency.findUnique({
          where: {
            project_id_operation_idempotency_key: {
              project_id: BigInt(projectId),
              operation: IDEMPOTENCY_OPERATION,
              idempotency_key: clientToken,
            },
          },
          select: { request_hash: true, generation_job_id: true },
        });
        if (existing) {
          if (existing.request_hash !== requestHash) {
            return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
          }
          if (existing.generation_job_id === null) {
            return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
          }
          const replayed = await tx.generation_jobs.findUnique({
            where: { id: existing.generation_job_id },
            select: { status: true },
          });
          if (!replayed) {
            return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
          }
          return ok({
            job_id: existing.generation_job_id.toString(),
            status: replayed.status,
          });
        }
      }

      return withBillingCompensation(jobBilling, async (billing) => {
        const job = await tx.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: VIDEO_SCENE_SPLIT_JOB_TYPE,
            source: VIDEO_SCENE_SPLIT_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        await billing?.charge(Number(job.id));
        createdJobId = job.id.toString();
        await tx.command_idempotency.create({
          data: {
            project_id: BigInt(projectId),
            operation: IDEMPOTENCY_OPERATION,
            idempotency_key: clientToken,
            request_hash: requestHash,
            generation_job_id: job.id,
            accepted_cursor: 0n,
          },
        });
        if (recoveryPlan && canvasBinding) {
          await writeCanvasRecoveryRows(tx, recoveryPlan, job.id);
          return ok({
            job_id: job.id.toString(),
            status: "queued",
            canvas_binding: {
              protocol_version: CANVAS_RECOVERY_PROTOCOL_VERSION,
              submission_id: canvasBinding.submission_id,
              target_node_id: canvasBinding.target_node_id,
              binding_revision: recoveryPlan.bindingRevision,
              job_id: job.id.toString(),
              is_current: true,
            },
          });
        }
        return ok({
          job_id: job.id.toString(),
          status: "queued",
        });
      }).then((result) => {
        callbackCompleted = true;
        return result;
      });
      });
      committed = true;
      if (createdJobId !== null) {
        await enqueueMediaToolJob({
          prisma: this.prisma.client,
          billing: this.billing,
          userId,
          toolType: VIDEO_SCENE_SPLIT_JOB_TYPE,
          jobId: createdJobId,
          enqueue: enqueueVideoSceneSplitJob,
          releaseOnFailure: jobBilling !== undefined,
        });
      }
      return result;
    } catch (error) {
      const failedJobId = !committed && callbackCompleted ? createdJobId : null;
      if (failedJobId !== null && jobBilling) {
        await jobBilling
          .release(
            Number(failedJobId),
            error instanceof Error ? error.message : String(error),
          )
          .catch(() => undefined);
      }
      if (error instanceof RecoveryContractError) return error.envelope;
      throw error;
    }
  }
}
