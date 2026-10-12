import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  CANVAS_RECOVERY_PROTOCOL_VERSION,
  FAILURE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT,
  VOCAL_SPLIT_DEFAULT_SCENE,
  VOCAL_SPLIT_INPUT_KEYS,
  VOCAL_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_OUTPUT_FORMATS,
  VOCAL_SPLIT_SCENES,
  VOCAL_SPLIT_SOURCE,
  canvasBindingSchema,
  fail,
  ok,
  vocalSplitInputSchema,
  type CanvasBinding,
  type VocalSplitInput,
  type VocalSplitOutputFormat,
  type VocalSplitScene,
} from "@lib/contracts";
import {
  RecoveryContractError,
  canvasBindingView,
  createGenerationCommandRepo,
  lockCanvasRecoveryForAcceptance,
  writeCanvasRecoveryRows,
  type CanvasRecoveryAcceptance,
} from "@lib/shared/persistence/index.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

const SUPPORTED_SCENES: ReadonlySet<string> = new Set(VOCAL_SPLIT_SCENES);
const SUPPORTED_FORMATS: ReadonlySet<string> = new Set(VOCAL_SPLIT_OUTPUT_FORMATS);

const IDEMPOTENCY_OPERATION = "vocal_split.create";

function isSupportedScene(value: unknown): value is VocalSplitScene {
  return typeof value === "string" && SUPPORTED_SCENES.has(value);
}

function isSupportedFormat(value: unknown): value is VocalSplitOutputFormat {
  return typeof value === "string" && SUPPORTED_FORMATS.has(value);
}

@Injectable()
export class VocalSplitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: { source_asset_id?: unknown; scene?: unknown; output_format?: unknown; canvas_binding?: unknown },
    idempotencyKey?: string,
  ) {
    const sourceAssetId =
      typeof body.source_asset_id === "number" ||
      typeof body.source_asset_id === "string"
        ? String(body.source_asset_id)
        : "";
    if (!sourceAssetId) {
      return fail(PARAM_MISSING_CODE, "缺少 source_asset_id");
    }
    let scene: VocalSplitScene = VOCAL_SPLIT_DEFAULT_SCENE;
    if (body.scene !== undefined) {
      if (!isSupportedScene(body.scene)) {
        return fail(PARAM_MISSING_CODE, "scene 仅支持 audio / music / drama / narrate");
      }
      scene = body.scene;
    }
    let outputFormat: VocalSplitOutputFormat = VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT;
    if (body.output_format !== undefined) {
      if (!isSupportedFormat(body.output_format)) {
        return fail(PARAM_MISSING_CODE, "output_format 仅支持 aac / mp3 / wav / m4a / flac");
      }
      outputFormat = body.output_format;
    }

    if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
      return fail(400, "Idempotency-Key 必须为字符串", {
        reason: RECOVERY_REASONS.invalidPayload,
      });
    }

    let canvasBinding: CanvasBinding | null = null;
    if (body.canvas_binding !== undefined && body.canvas_binding !== null) {
      const parsedBinding = canvasBindingSchema.safeParse(body.canvas_binding);
      if (!parsedBinding.success) {
        return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
      }
      canvasBinding = parsedBinding.data;
      if ((idempotencyKey ?? "").trim() !== canvasBinding.submission_id) {
        return fail(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", {
          reason: RECOVERY_REASONS.invalidPayload,
        });
      }
    }

    const parsed = vocalSplitInputSchema.safeParse({
      [VOCAL_SPLIT_INPUT_KEYS.sourceAssetId]: sourceAssetId,
      [VOCAL_SPLIT_INPUT_KEYS.scene]: scene,
      [VOCAL_SPLIT_INPUT_KEYS.outputFormat]: outputFormat,
    });
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, "source_asset_id 必须为正整数 ID");
    }
    const input: VocalSplitInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    const asset = await this.assets.findOwnedSource(sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video" && asset.type !== "audio") {
      return fail(FAILURE_CODE, "仅支持从视频或音频资产发起人声背景分离");
    }

    if (canvasBinding) {
      const requestHash = createHash("sha256")
        .update(
          `POST:/api/projects/${projectId}/vocal-splits` +
            `\0${input[VOCAL_SPLIT_INPUT_KEYS.sourceAssetId]}` +
            `\0${input[VOCAL_SPLIT_INPUT_KEYS.scene]}` +
            `\0${input[VOCAL_SPLIT_INPUT_KEYS.outputFormat]}` +
            `\0${JSON.stringify(canvasBinding)}`,
        )
        .digest("hex");
      const acceptance: CanvasRecoveryAcceptance = {
        projectId,
        userId,
        binding: canvasBinding,
        operation: IDEMPOTENCY_OPERATION,
        requestHash,
        idempotencyKey: canvasBinding.submission_id,
        taskType: VOCAL_SPLIT_JOB_TYPE,
      };
      try {
        return await this.prisma.client.$transaction(async (tx) => {
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
            return fail(IDEMPOTENCY_KEY_REUSED_CODE, "Idempotency-Key 已被使用（同键仅可重放相同参数）");
          }
          const job = await tx.generation_jobs.create({
            data: {
              user_id: BigInt(userId),
              project_id: BigInt(projectId),
              type: VOCAL_SPLIT_JOB_TYPE,
              source: VOCAL_SPLIT_SOURCE,
              status: "queued",
              progress: 0,
              input: {
                ...input,
              },
              next_action_at: new Date(Date.now() - 60_000),
            },
          });
          await tx.command_idempotency.create({
            data: {
              project_id: BigInt(projectId),
              operation: IDEMPOTENCY_OPERATION,
              idempotency_key: canvasBinding.submission_id,
              request_hash: requestHash,
              generation_job_id: job.id,
              accepted_cursor: 0n,
            },
          });
          await writeCanvasRecoveryRows(tx, locked.plan, job.id);
          return ok({
            job_id: job.id.toString(),
            status: "queued",
            canvas_binding: {
              protocol_version: CANVAS_RECOVERY_PROTOCOL_VERSION,
              submission_id: canvasBinding.submission_id,
              target_node_id: canvasBinding.target_node_id,
              binding_revision: locked.plan.bindingRevision,
              job_id: job.id.toString(),
              is_current: true,
            },
          });
        });
      } catch (error) {
        if (error instanceof RecoveryContractError) return error.envelope;
        throw error;
      }
    }

    const job = await this.prisma.client.generation_jobs.create({
      data: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: VOCAL_SPLIT_JOB_TYPE,
        source: VOCAL_SPLIT_SOURCE,
        status: "queued",
        progress: 0,
        input: {
          ...input,
        },
        next_action_at: new Date(Date.now() - 60_000),
      },
    });
    return ok({
      job_id: job.id.toString(),
      status: "queued",
    });
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
