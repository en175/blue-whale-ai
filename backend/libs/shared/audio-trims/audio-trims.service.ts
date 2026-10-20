import type { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import {
  ASSET_UNAVAILABLE_CODE,
  AUDIO_TRIM_INPUT_KEYS,
  AUDIO_TRIM_JOB_TYPE,
  AUDIO_TRIM_OUTPUT_FORMATS,
  AUDIO_TRIM_SOURCE,
  FAILURE_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  audioTrimInputSchema,
  defaultAudioTrimOutputFormat,
  fail,
  type AudioTrimOutputFormat,
} from "@lib/contracts";
import {
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueAudioTrimJob } from "@lib/shared/generation/generation-queue.js";
import { submitMediaToolJob } from "@lib/shared/media-tools/media-tool-submission.js";
import { resolveSourceDuration } from "@lib/shared/media-tools/source-duration.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
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
    private readonly storage: AssetStorageService,
    private readonly billing: MediaToolBillingService,
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

    const duration = await resolveSourceDuration({
      prisma: this.prisma.client,
      storage: this.storage,
      asset: {
        id: sourceAssetId,
        storage_key: asset.storage_key,
        duration_ms: asset.duration_ms,
      },
    });
    if (duration === null) {
      return fail(
        ASSET_UNAVAILABLE_CODE,
        "源音频时长读取失败，请稍后重试或更换素材",
        { code: "asset_unavailable" },
      );
    }
    const start = parsed.data.start_time ?? 0;
    const end = Math.min(parsed.data.end_time ?? duration.seconds, duration.seconds);
    const selectedSeconds = Math.ceil(end - start);
    if (selectedSeconds <= 0) {
      return fail(PARAM_MISSING_CODE, "截取区间超出源音频时长");
    }
    const frozenInput = { ...parsed.data, duration: selectedSeconds } as Prisma.InputJsonObject;

    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: AUDIO_TRIM_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: AUDIO_TRIM_JOB_TYPE,
            source: AUDIO_TRIM_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueAudioTrimJob,
    });
  }
}
