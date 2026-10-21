import type { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import {
  AUDIO_SPEED_INPUT_KEYS,
  AUDIO_SPEED_JOB_TYPE,
  AUDIO_SPEED_SOURCE,
  PARAM_MISSING_CODE,
  audioSpeedInputSchema,
  fail,
} from "@lib/contracts";
import {
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueAudioSpeedJob } from "@lib/shared/generation/generation-queue.js";
import { submitMediaToolJob } from "@lib/shared/media-tools/media-tool-submission.js";
import { speedChargeSeconds } from "@lib/shared/media-tool-pricing/tool-quote-input.js";
import {
  requireOwnedProject,
  resolveOwnedMediaSource,
} from "@lib/shared/media-tools/owned-media-source.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

const IDEMPOTENCY_OPERATION = "audio_speed.create";
const REQUEST_PATH = "/audio-speeds";

@Injectable()
export class AudioSpeedsService {
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
      speed?: unknown;
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

    const projectError = await requireOwnedProject({
      projects: this.project,
      projectId,
      userId,
    });
    if (projectError) return projectError;

    const { recovery, replayed } = await replayAcceptedMediaTool(this.prisma.client, {
      projectId,
      userId,
      binding,
      taskType: AUDIO_SPEED_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
    });
    if (replayed) return replayed;

    const source = await resolveOwnedMediaSource({
      prisma: this.prisma.client,
      assets: this.assets,
      storage: this.storage,
      userId,
      assetId: sourceAssetId,
      expectedTypes: ["audio"],
      wrongTypeMessage: "仅支持调速音频资产",
      durationMessage: "源音频时长读取失败，请稍后重试或更换素材",
    });
    if (!source.ok) return source.envelope;
    const duration = source.duration!;

    const input = {
      [AUDIO_SPEED_INPUT_KEYS.sourceAssetId]: sourceAssetId,
      ...(rest.speed !== undefined ? { [AUDIO_SPEED_INPUT_KEYS.speed]: rest.speed } : {}),
    };
    const parsed = audioSpeedInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音频调速参数非法");
    }

    const speed = parsed.data.speed ?? 1;
    const outputSeconds = speedChargeSeconds(duration.seconds, speed);
    const frozenInput = { ...parsed.data, duration: outputSeconds } as Prisma.InputJsonObject;

    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: AUDIO_SPEED_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: AUDIO_SPEED_JOB_TYPE,
            source: AUDIO_SPEED_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueAudioSpeedJob,
    });
  }
}
