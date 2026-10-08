import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT,
  MEDIA_EXTRACT_INPUT_KEYS,
  MEDIA_EXTRACT_JOB_TYPE,
  MEDIA_EXTRACT_OUTPUT_FORMATS,
  MEDIA_EXTRACT_SOURCE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
  type MediaExtractOutputFormat,
} from "@lib/contracts";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import {
  createMediaToolJobWithRecovery,
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

const IDEMPOTENCY_OPERATION = "media_extract.create";
const REQUEST_PATH = "/media-extractions";

const SUPPORTED_FORMATS: ReadonlySet<string> = new Set(MEDIA_EXTRACT_OUTPUT_FORMATS);

function isSupportedFormat(value: unknown): value is MediaExtractOutputFormat {
  return typeof value === "string" && SUPPORTED_FORMATS.has(value);
}

@Injectable()
export class MediaExtractionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: { source_asset_id?: unknown; output_format?: unknown; canvas_binding?: unknown },
    idempotencyKey?: string,
  ) {
    const gate = stripCanvasBinding(
      body ?? ({} as Record<string, unknown>),
      "Idempotency-Key",
      (idempotencyKey ?? "").trim(),
    );
    if (gate.error) return gate.error;
    const { binding, rest } = gate;
    const sourceAssetId =
      typeof rest.source_asset_id === "number" ||
      typeof rest.source_asset_id === "string"
        ? String(rest.source_asset_id)
        : "";
    if (!sourceAssetId) {
      return fail(PARAM_MISSING_CODE, "缺少 source_asset_id");
    }
    let outputFormat: MediaExtractOutputFormat = MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT;
    if (rest.output_format !== undefined) {
      if (!isSupportedFormat(rest.output_format)) {
        return fail(PARAM_MISSING_CODE, "output_format 仅支持 m4a / mp3 / ogg / flac / wav");
      }
      outputFormat = rest.output_format;
    }

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    const { recovery, replayed } = await replayAcceptedMediaTool(this.prisma.client, {
      projectId,
      userId,
      binding,
      taskType: MEDIA_EXTRACT_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
    });
    if (replayed) return replayed;

    const asset = await this.assets.findOwnedSource(sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持从视频资产提取音频");
    }

    const outcome = await createMediaToolJobWithRecovery(
      this.prisma.client,
      recovery,
      async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: MEDIA_EXTRACT_JOB_TYPE,
            source: MEDIA_EXTRACT_SOURCE,
            status: "queued",
            progress: 0,
            input: {
              [MEDIA_EXTRACT_INPUT_KEYS.sourceAssetId]: sourceAssetId,
              [MEDIA_EXTRACT_INPUT_KEYS.outputFormat]: outputFormat,
            },
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
    );
    if (outcome.kind === "envelope") return outcome.envelope;
    if (outcome.kind === "idempotency_conflict") {
      return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
    }
    return ok({
      job_id: outcome.jobId,
      status: outcome.status,
      ...(outcome.bindingView ? { canvas_binding: outcome.bindingView } : {}),
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
