import { wallClockRfc3339 } from "@lib/core";
import type { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import {
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS,
  VIDEO_FRAME_INTERPOLATION_FPS_VALUES,
  VIDEO_FRAME_INTERPOLATION_INPUT_KEYS,
  VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
  VIDEO_FRAME_INTERPOLATION_SOURCE,
  fail,
  ok,
  videoFrameInterpolationInputSchema,
  videoFrameInterpolationRecoveryQuerySchema,
  type VideoFrameInterpolationInput,
} from "@lib/contracts";
import {
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueVideoFrameInterpolationJob } from "@lib/shared/generation/generation-queue.js";
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

const IDEMPOTENCY_OPERATION = "video_frame_interpolation.create";
const REQUEST_PATH = "/video-frame-interpolations";

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.sourceAssetId]:
    "缺少或非法的源素材 ID（source_asset_id）",
  [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.fps]: `目标帧率仅支持 ${VIDEO_FRAME_INTERPOLATION_FPS_VALUES.join(
    " / ",
  )}（缺省按 ${VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS} 处理）`,
};

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许视频插帧任务的 source_asset_id / target_node_id / fps 键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

@Injectable()
export class VideoFrameInterpolationsService {
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
    idempotencyKey?: string,
  ) {
    const gate = stripCanvasBinding(body ?? {}, "Idempotency-Key", (idempotencyKey ?? "").trim());
    if (gate.error) return gate.error;
    const { binding, rest } = gate;

    const parsed = videoFrameInterpolationInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoFrameInterpolationInput = parsed.data;

    const projectError = await requireOwnedProject({
      projects: this.project,
      projectId,
      userId,
    });
    if (projectError) return projectError;

    const { recovery, legacy, replayed } = await replayAcceptedMediaTool(this.prisma.client, {
      projectId,
      userId,
      binding,
      taskType: VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
      idempotencyKey,
    });
    if (replayed) return replayed;

    const source = await resolveOwnedMediaSource({
      prisma: this.prisma.client,
      assets: this.assets,
      storage: this.storage,
      userId,
      assetId: input[VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.sourceAssetId],
      expectedTypes: ["video"],
      wrongTypeMessage: "仅支持对视频资产发起视频插帧",
      durationMessage: "源视频时长读取失败，请稍后重试或更换素材",
    });
    if (!source.ok) return source.envelope;
    const duration = source.duration!;

    const frozenInput = { ...input, duration: duration.seconds } as Prisma.InputJsonObject;

    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      legacy,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
            source: VIDEO_FRAME_INTERPOLATION_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueVideoFrameInterpolationJob,
    });
  }

  async findCurrent(userId: string, projectId: string, query: Record<string, unknown>) {
    const parsed = videoFrameInterpolationRecoveryQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, "缺少目标节点 ID（target_node_id）");
    }
    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    const job = await this.prisma.client.generation_jobs.findFirst({
      where: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
        is_delete: false,
        input: {
          path: "$." + VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId,
          equals: parsed.data[VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId],
        },
      },
      orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
    });
    if (!job) return ok(null);
    return ok({
      job_id: job.id.toString(),
      status: job.status,
      progress: job.progress,
      created_at: wallClockRfc3339(job.gmt_create),
    });
  }
}
