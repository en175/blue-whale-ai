import type { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import {
  ASSET_UNAVAILABLE_CODE,
  FAILURE_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_ENHANCE_INPUT_KEYS,
  VIDEO_ENHANCE_JOB_TYPE,
  VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX,
  VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_SOURCE,
  fail,
  videoEnhanceInputSchema,
  type VideoEnhanceInput,
} from "@lib/contracts";
import {
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueVideoEnhanceJob } from "@lib/shared/generation/generation-queue.js";
import { submitMediaToolJob } from "@lib/shared/media-tools/media-tool-submission.js";
import { resolveSourceDurationSeconds } from "@lib/shared/media-tools/source-duration.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

const IDEMPOTENCY_OPERATION = "video_enhance.create";
const REQUEST_PATH = "/video-enhancements";

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [VIDEO_ENHANCE_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [VIDEO_ENHANCE_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [VIDEO_ENHANCE_INPUT_KEYS.resolution]:
    "目标分辨率仅支持 1080p / 2k / 4k",
};

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许 HD 高清任务的 source_asset_id / target_node_id / resolution 键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

@Injectable()
export class VideoEnhancementsService {
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

    const parsed = videoEnhanceInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoEnhanceInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    const { recovery, replayed } = await replayAcceptedMediaTool(this.prisma.client, {
      projectId,
      userId,
      binding,
      taskType: VIDEO_ENHANCE_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
    });
    if (replayed) return replayed;

    const asset = await this.assets.findOwnedSource(
      input[VIDEO_ENHANCE_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持对视频资产发起 HD 高清");
    }

    if (asset.width != null && asset.height != null) {
      const longSide = Math.max(asset.width, asset.height);
      const shortSide = Math.min(asset.width, asset.height);
      if (
        shortSide < VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX ||
        shortSide > VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX ||
        longSide > VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX
      ) {
        return fail(
          FAILURE_CODE,
          `源视频短边须在 ${VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX}~${VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX}、长边不超过 ${VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX} 像素，无法发起 HD 高清`,
        );
      }
    }

    const durationSeconds = await resolveSourceDurationSeconds({
      prisma: this.prisma.client,
      storage: this.storage,
      asset: {
        id: input[VIDEO_ENHANCE_INPUT_KEYS.sourceAssetId],
        storage_key: asset.storage_key,
        duration_ms: asset.duration_ms,
      },
    });
    if (durationSeconds === null) {
      return fail(
        ASSET_UNAVAILABLE_CODE,
        "源视频时长读取失败，请稍后重试或更换素材",
        { code: "asset_unavailable" },
      );
    }

    const frozenInput = { ...input, duration: durationSeconds } as Prisma.InputJsonObject;

    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: VIDEO_ENHANCE_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: VIDEO_ENHANCE_JOB_TYPE,
            source: VIDEO_ENHANCE_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueVideoEnhanceJob,
    });
  }
}
