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
} from "@lib/shared/persistence/index.js";
import {
  jobExistenceProbe,
  releaseUnlessJobCommitted,
} from "@lib/shared/persistence/job-billing.js";
import { enqueueVideoSceneSplitJob } from "@lib/shared/generation/generation-queue.js";
import {
  enqueueMediaToolJob,
} from "@lib/shared/media-tools/media-tool-submission.js";
import { acceptDedicatedToolJob, DedicatedToolConflictError } from "@lib/shared/media-tools/dedicated-tool-acceptance.js";
import {
  requireOwnedProject,
  resolveOwnedMediaSource,
} from "@lib/shared/media-tools/owned-media-source.js";
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

    const projectError = await requireOwnedProject({
      projects: this.project,
      projectId,
      userId,
    });
    if (projectError) return projectError;

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

    const source = await resolveOwnedMediaSource({
      prisma: this.prisma.client,
      assets: this.assets,
      storage: this.storage,
      userId,
      assetId: input[VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId],
      expectedTypes: ["video"],
      wrongTypeMessage: "仅支持对视频资产发起场景切分",
      durationMessage: "源视频时长读取失败，请稍后重试或更换素材",
      maxDurationMs: VIDEO_SCENE_SPLIT_MAX_DURATION_MS,
      maxDurationMessage: "暂支持 2 小时以内的视频场景切分",
    });
    if (!source.ok) return source.envelope;
    const duration = source.duration!;

    const frozenInput = { ...input, duration: duration.seconds } as Prisma.InputJsonObject;
    const jobBilling = await this.billing.jobBilling(
      VIDEO_SCENE_SPLIT_JOB_TYPE,
      userId,
      frozenInput,
    );
    const acceptanceBilling = jobBilling
      ? {
          charge: (jobId: number) => jobBilling.charge(jobId),
          release: (jobId: number, reason: string) =>
            this.billing.release(userId, jobId, reason),
        }
      : undefined;

    const replayStored = async () => {
      if (canvasBinding) return null;
      const existing = await this.prisma.client.command_idempotency.findUnique({
        where: {
          project_id_operation_idempotency_key: {
            project_id: BigInt(projectId),
            operation: IDEMPOTENCY_OPERATION,
            idempotency_key: clientToken,
          },
        },
        select: { request_hash: true, generation_job_id: true },
      });
      if (!existing) return null;
      if (existing.request_hash !== requestHash || existing.generation_job_id === null) {
        return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
      }
      const replayed = await this.prisma.client.generation_jobs.findUnique({
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
    };

    let createdJobId: string | null = null;
    let conflictEnvelope: ReturnType<typeof fail> | null = null;
    try {
      const previous = await replayStored();
      if (previous) return previous;
      const accepted = await acceptDedicatedToolJob({
        prisma: this.prisma.client,
        jobBilling: acceptanceBilling,
        userId,
        projectId,
        toolType: VIDEO_SCENE_SPLIT_JOB_TYPE,
        operation: IDEMPOTENCY_OPERATION,
        requestHash,
        idempotencyKey: clientToken,
        canvasBinding,
        conflictMessage: "client_token 已被使用（同 token 仅可重放相同参数）",
        onConflict: () => {
          conflictEnvelope = fail(
            IDEMPOTENCY_KEY_REUSED_CODE,
            "client_token 已被使用（同 token 仅可重放相同参数）",
          );
          throw new DedicatedToolConflictError();
        },
        createData: {
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
      if (accepted.replayed) {
        const jobId = accepted.jobId ?? "";
        const replayed = jobId
          ? await this.prisma.client.generation_jobs.findUnique({
              where: { id: BigInt(jobId) },
              select: { status: true },
            })
          : null;
        return ok({
          job_id: jobId,
          status: replayed?.status ?? "queued",
          ...(canvasBinding
            ? {
                canvas_binding: await canvasBindingView(
                  this.prisma.client,
                  projectId,
                  canvasBinding.submission_id,
                ),
              }
            : {}),
        });
      }
      createdJobId = accepted.jobId;
      if (createdJobId !== null) {
        await enqueueMediaToolJob({
          prisma: this.prisma.client,
          billing: this.billing,
          userId,
          toolType: VIDEO_SCENE_SPLIT_JOB_TYPE,
          jobId: createdJobId,
          enqueue: enqueueVideoSceneSplitJob,
        });
      }
      return ok({
        job_id: createdJobId ?? "",
        status: "queued",
        ...(canvasBinding
          ? {
              canvas_binding: {
                protocol_version: CANVAS_RECOVERY_PROTOCOL_VERSION,
                submission_id: canvasBinding.submission_id,
                target_node_id: canvasBinding.target_node_id,
                binding_revision: accepted.bindingRevision ?? 0,
                job_id: createdJobId ?? "",
                is_current: true,
              },
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof DedicatedToolConflictError && conflictEnvelope) {
        return conflictEnvelope;
      }
      if (error instanceof RecoveryContractError) return error.envelope;
      const replayed = await replayStored();
      if (replayed) return replayed;
      throw error;
    }
  }
}
