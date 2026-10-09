import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
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
  RecoveryContractError,
  canvasBindingView,
  createGenerationCommandRepo,
  lockCanvasRecoveryForAcceptance,
  writeCanvasRecoveryRows,
  type CanvasRecoveryAcceptance,
  type CanvasRecoveryPlan,
} from "@lib/shared/persistence/index.js";
import { transactionWithUniqueRetry } from "@lib/shared/persistence/conversation-repo.js";
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

    try {
      return await transactionWithUniqueRetry(this.prisma.client, async (tx) => {
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

      const asset = await this.assets.findOwnedSource(
        input[VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId],
        userId,
      );
      if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
      if (asset.type !== "video") {
        return fail(FAILURE_CODE, "仅支持对视频资产发起场景切分");
      }

      if (asset.duration_ms != null && asset.duration_ms > VIDEO_SCENE_SPLIT_MAX_DURATION_MS) {
        return fail(FAILURE_CODE, "暂支持 2 小时以内的视频场景切分");
      }

      const frozenInput: VideoSceneSplitInput = { ...input };

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
      });
    } catch (error) {
      if (error instanceof RecoveryContractError) return error.envelope;
      throw error;
    }
  }

  async markFailed(
    jobId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await createGenerationCommandRepo(this.prisma.client).markFailedQueued(
      jobId,
      code,
      message,
      details,
    );
  }
}
