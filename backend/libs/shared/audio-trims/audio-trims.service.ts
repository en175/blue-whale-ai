import { Injectable } from "@nestjs/common";
import {
  AUDIO_TRIM_INPUT_KEYS,
  AUDIO_TRIM_JOB_TYPE,
  AUDIO_TRIM_OUTPUT_FORMATS,
  AUDIO_TRIM_SOURCE,
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  audioTrimInputSchema,
  defaultAudioTrimOutputFormat,
  fail,
  ok,
  type AudioTrimOutputFormat,
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

const IDEMPOTENCY_OPERATION = "audio_trim.create";
const REQUEST_PATH = "/audio-trims";

const SUPPORTED_FORMATS: ReadonlySet<string> = new Set(AUDIO_TRIM_OUTPUT_FORMATS);

function isSupportedFormat(value: unknown): value is AudioTrimOutputFormat {
  return typeof value === "string" && SUPPORTED_FORMATS.has(value);
}

@Injectable()
export class AudioTrimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: {
      source_asset_id?: unknown;
      start_time?: unknown;
      end_time?: unknown;
      output_format?: unknown;
      canvas_binding?: unknown;
    },
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
    let explicitOutputFormat: AudioTrimOutputFormat | undefined;
    if (rest.output_format !== undefined) {
      if (!isSupportedFormat(rest.output_format)) {
        return fail(PARAM_MISSING_CODE, "output_format 仅支持 mp3 / m4a / ogg / flac / wav");
      }
      explicitOutputFormat = rest.output_format;
    }

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    const { recovery, replayed } = await replayAcceptedMediaTool(this.prisma.client, {
      projectId,
      userId,
      binding,
      taskType: AUDIO_TRIM_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
    });
    if (replayed) return replayed;

    const asset = await this.assets.findOwnedSource(sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "audio") {
      return fail(FAILURE_CODE, "仅支持截取音频资产");
    }

    const outputFormat =
      explicitOutputFormat ?? defaultAudioTrimOutputFormat(asset.storage_key ?? "");

    const input = {
      [AUDIO_TRIM_INPUT_KEYS.sourceAssetId]: sourceAssetId,
      ...(rest.start_time !== undefined
        ? { [AUDIO_TRIM_INPUT_KEYS.startTime]: rest.start_time }
        : {}),
      ...(rest.end_time !== undefined ? { [AUDIO_TRIM_INPUT_KEYS.endTime]: rest.end_time } : {}),
      [AUDIO_TRIM_INPUT_KEYS.outputFormat]: outputFormat,
    };
    const parsed = audioTrimInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音频截取参数非法");
    }

    const outcome = await createMediaToolJobWithRecovery(
      this.prisma.client,
      recovery,
      async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: AUDIO_TRIM_JOB_TYPE,
            source: AUDIO_TRIM_SOURCE,
            status: "queued",
            progress: 0,
            input: {
              ...parsed.data,
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
