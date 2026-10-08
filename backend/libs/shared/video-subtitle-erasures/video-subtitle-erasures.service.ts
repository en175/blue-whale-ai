import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_SUBTITLE_ERASE_INPUT_KEYS,
  VIDEO_SUBTITLE_ERASE_JOB_TYPE,
  VIDEO_SUBTITLE_ERASE_MAX_BOXES,
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_SOURCE,
  fail,
  ok,
  videoSubtitleEraseInputSchema,
  type VideoSubtitleEraseInput,
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

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    const { recovery, replayed } = await replayAcceptedMediaTool(this.prisma.client, {
      projectId,
      userId,
      binding,
      taskType: VIDEO_SUBTITLE_ERASE_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
    });
    if (replayed) return replayed;

    const asset = await this.assets.findOwnedSource(
      input[VIDEO_SUBTITLE_ERASE_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持对视频资产发起去字幕");
    }

    if (asset.width != null && asset.height != null) {
      const longSide = Math.max(asset.width, asset.height);
      const shortSide = Math.min(asset.width, asset.height);
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
    if (asset.duration_ms != null && asset.duration_ms > VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS) {
      return fail(FAILURE_CODE, "暂支持 10 分钟以内的视频去字幕");
    }

    const frozenInput: VideoSubtitleEraseInput = { ...input };

    const outcome = await createMediaToolJobWithRecovery(
      this.prisma.client,
      recovery,
      async (db) => {
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
