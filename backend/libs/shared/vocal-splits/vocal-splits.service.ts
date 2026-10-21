import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import {
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT,
  VOCAL_SPLIT_DEFAULT_SCENE,
  VOCAL_SPLIT_INPUT_KEYS,
  VOCAL_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_OUTPUT_FORMATS,
  VOCAL_SPLIT_SCENES,
  VOCAL_SPLIT_SOURCE,
  canvasBindingSchema,
  fail,
  vocalSplitInputSchema,
  type CanvasBinding,
  type VocalSplitInput,
  type VocalSplitOutputFormat,
  type VocalSplitScene,
} from "@lib/contracts";
import {
  readAcceptedMediaToolReplay,
  renderMediaToolReplay,
  type MediaToolRecovery,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueVocalSplitJob } from "@lib/shared/generation/generation-queue.js";
import { submitMediaToolJob } from "@lib/shared/media-tools/media-tool-submission.js";
import {
  requireOwnedProject,
  resolveOwnedMediaSource,
} from "@lib/shared/media-tools/owned-media-source.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
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
    private readonly storage: AssetStorageService,
    private readonly billing: MediaToolBillingService,
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

    const projectError = await requireOwnedProject({
      projects: this.project,
      projectId,
      userId,
    });
    if (projectError) return projectError;

    const requestHash = canvasBinding
      ? createHash("sha256")
          .update(
            `POST:/api/projects/${projectId}/vocal-splits` +
              `\0${input[VOCAL_SPLIT_INPUT_KEYS.sourceAssetId]}` +
              `\0${input[VOCAL_SPLIT_INPUT_KEYS.scene]}` +
              `\0${input[VOCAL_SPLIT_INPUT_KEYS.outputFormat]}` +
              `\0${JSON.stringify(canvasBinding)}`,
          )
          .digest("hex")
      : "";
    const recovery: MediaToolRecovery | null = canvasBinding
      ? {
          projectId,
          userId,
          taskType: VOCAL_SPLIT_JOB_TYPE,
          operation: IDEMPOTENCY_OPERATION,
          requestHash,
          binding: canvasBinding,
        }
      : null;
    if (recovery) {
      const replay = await readAcceptedMediaToolReplay(this.prisma.client, recovery);
      if (replay) {
        return renderMediaToolReplay(replay, () =>
          fail(IDEMPOTENCY_KEY_REUSED_CODE, "Idempotency-Key 已被使用（同键仅可重放相同参数）"),
        );
      }
    }

    const source = await resolveOwnedMediaSource({
      prisma: this.prisma.client,
      assets: this.assets,
      storage: this.storage,
      userId,
      assetId: sourceAssetId,
      expectedTypes: ["video", "audio"],
      wrongTypeMessage: "仅支持从视频或音频资产发起人声背景分离",
      durationMessage: "源素材时长读取失败，请稍后重试或更换素材",
    });
    if (!source.ok) return source.envelope;
    const duration = source.duration!;
    const frozenInput = { ...input, duration: duration.seconds } as Prisma.InputJsonObject;

    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: VOCAL_SPLIT_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: VOCAL_SPLIT_JOB_TYPE,
            source: VOCAL_SPLIT_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueVocalSplitJob,
    });
  }
}
