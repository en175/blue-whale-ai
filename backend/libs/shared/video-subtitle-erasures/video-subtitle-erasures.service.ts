import type { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  PARAM_MISSING_CODE,
  VIDEO_SUBTITLE_ERASE_INPUT_KEYS,
  VIDEO_SUBTITLE_ERASE_JOB_TYPE,
  VIDEO_SUBTITLE_ERASE_MAX_BOXES,
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_SOURCE,
  fail,
  videoSubtitleEraseInputSchema,
  type VideoSubtitleEraseInput,
} from "@lib/contracts";
import {
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueVideoSubtitleEraseJob } from "@lib/shared/generation/generation-queue.js";
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

const IDEMPOTENCY_OPERATION = "video_subtitle_erase.create";
const REQUEST_PATH = "/video-subtitle-erasures";

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.detectMode]: "检测模式仅支持 subtitle_smart / text_full",
  [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.eraseBoxes]: `擦除框列表不合法（最多 ${VIDEO_SUBTITLE_ERASE_MAX_BOXES} 个框，每框 top_left_x / top_left_y / bottom_right_x / bottom_right_y 取值 0~1）`,
};

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许去字幕任务的 source_asset_id / target_node_id / detect_mode / erase_boxes 键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

@Injectable()
export class VideoSubtitleErasuresService {
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

    const parsed = videoSubtitleEraseInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoSubtitleEraseInput = parsed.data;

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
      taskType: VIDEO_SUBTITLE_ERASE_JOB_TYPE,
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
      assetId: input[VIDEO_SUBTITLE_ERASE_INPUT_KEYS.sourceAssetId],
      expectedTypes: ["video"],
      wrongTypeMessage: "仅支持对视频资产发起去字幕",
      durationMessage: "源视频时长读取失败，请稍后重试或更换素材",
      secondsPolicy: "floor",
      probeDimensions: true,
      maxDurationMs: VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
      maxDurationMessage: "暂支持 10 分钟以内的视频去字幕",
    });
    if (!source.ok) return source.envelope;
    const asset = source.asset;
    const duration = source.duration!;

    const width = asset.width ?? duration.width;
    const height = asset.height ?? duration.height;
    if (width != null && height != null) {
      const longSide = Math.max(width, height);
      const shortSide = Math.min(width, height);
      if (
        longSide > VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX ||
        shortSide > VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX
      ) {
        return fail(
          FAILURE_CODE,
          `视频长边超过 ${VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX} 或短边超过 ${VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX} 像素上限（2K），无法去字幕`,
        );
      }
    }
    if (duration.durationMs > VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS) {
      return fail(FAILURE_CODE, "暂支持 10 分钟以内的视频去字幕");
    }

    const frozenInput = { ...input, duration: duration.seconds } as Prisma.InputJsonObject;

    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: VIDEO_SUBTITLE_ERASE_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      legacy,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: VIDEO_SUBTITLE_ERASE_JOB_TYPE,
            source: VIDEO_SUBTITLE_ERASE_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueVideoSubtitleEraseJob,
    });
  }
}
