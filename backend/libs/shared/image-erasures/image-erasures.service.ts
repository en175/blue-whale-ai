import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IMAGE_ERASE_INPUT_FORMATS,
  IMAGE_ERASE_INPUT_KEYS,
  IMAGE_ERASE_JOB_TYPE,
  IMAGE_ERASE_MAX_FILE_BYTES,
  IMAGE_ERASE_MAX_SHORT_SIDE_PX,
  IMAGE_ERASE_MAX_LONG_SIDE_PX,
  IMAGE_ERASE_MIN_SIDE_PX,
  IMAGE_ERASE_SOURCE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  imageEraseInputSchema,
  type ImageEraseInput,
} from "@lib/contracts";
import {
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueImageEraseJob } from "@lib/shared/generation/generation-queue.js";
import { submitMediaToolJob } from "@lib/shared/media-tools/media-tool-submission.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  requireOwnedProject,
  resolveOwnedMediaSource,
} from "@lib/shared/media-tools/owned-media-source.js";

const IDEMPOTENCY_OPERATION = "image_erase.create";
const REQUEST_PATH = "/image-erasures";

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [IMAGE_ERASE_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [IMAGE_ERASE_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [IMAGE_ERASE_INPUT_KEYS.eraseScene]: "擦除场景仅支持 full_screen_text_erase / selected_area_erase",
  [IMAGE_ERASE_INPUT_KEYS.maskAssetId]: "遮罩场景缺少或非法的遮罩素材 ID（mask_asset_id）",
};

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    if (first.keys?.includes(IMAGE_ERASE_INPUT_KEYS.maskAssetId)) {
      return "清除文字场景不支持传遮罩素材（mask_asset_id），请改用涂抹场景";
    }
    return "请求包含不支持的参数，仅允许擦除任务的 source_asset_id / target_node_id / erase_scene / mask_asset_id 键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

function detectAssetFormat(asset: {
  mime: string | null;
  url: string;
  storage_key: string | null;
}): string | null {
  const mime = asset.mime?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mime.startsWith("image/")) {
    const subtype = mime.slice("image/".length);
    if (subtype) return subtype;
  }
  for (const locator of [asset.url, asset.storage_key]) {
    if (!locator) continue;
    const path = locator.split("?", 1)[0] ?? locator;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (path.includes(".") && /^[a-z0-9]{2,8}$/.test(ext)) return ext;
  }
  return null;
}

@Injectable()
export class ImageErasuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
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

    const parsed = imageEraseInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: ImageEraseInput = parsed.data;

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
      taskType: IMAGE_ERASE_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
    });
    if (replayed) return replayed;

    const source = await resolveOwnedMediaSource({
      prisma: this.prisma.client,
      assets: this.assets,
      userId,
      assetId: input[IMAGE_ERASE_INPUT_KEYS.sourceAssetId],
      expectedTypes: ["image"],
      wrongTypeMessage: "仅支持对图片资产发起擦除",
    });
    if (!source.ok) return source.envelope;
    const asset = source.asset;

    if (input.erase_scene === "selected_area_erase") {
      const mask = await resolveOwnedMediaSource({
        prisma: this.prisma.client,
        assets: this.assets,
        userId,
        assetId: input[IMAGE_ERASE_INPUT_KEYS.maskAssetId],
        expectedTypes: ["image"],
        wrongTypeMessage: "遮罩素材必须是图片资产",
      });
      if (!mask.ok) return mask.envelope;
    }

    if (asset.width != null && asset.height != null) {
      const longSide = Math.max(asset.width, asset.height);
      const shortSide = Math.min(asset.width, asset.height);
      if (
        longSide > IMAGE_ERASE_MAX_LONG_SIDE_PX ||
        shortSide > IMAGE_ERASE_MAX_SHORT_SIDE_PX
      ) {
        return fail(
          FAILURE_CODE,
          `图片长边超过 ${IMAGE_ERASE_MAX_LONG_SIDE_PX} 或短边超过 ${IMAGE_ERASE_MAX_SHORT_SIDE_PX} 像素上限，无法擦除`,
        );
      }
      if (
        asset.width < IMAGE_ERASE_MIN_SIDE_PX ||
        asset.height < IMAGE_ERASE_MIN_SIDE_PX
      ) {
        return fail(
          FAILURE_CODE,
          `图片尺寸小于 ${IMAGE_ERASE_MIN_SIDE_PX}x${IMAGE_ERASE_MIN_SIDE_PX} 像素，无法擦除`,
        );
      }
    }
    if (asset.size != null && asset.size > IMAGE_ERASE_MAX_FILE_BYTES) {
      return fail(FAILURE_CODE, "图片大小超过 10MB 上限，无法擦除");
    }
    const format = detectAssetFormat(asset);
    if (!format || !(IMAGE_ERASE_INPUT_FORMATS as readonly string[]).includes(format)) {
      return fail(FAILURE_CODE, "仅支持 png / jpg / jpeg / heic 格式的图片发起擦除");
    }

    const frozenInput: ImageEraseInput = { ...input };

    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: IMAGE_ERASE_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: IMAGE_ERASE_JOB_TYPE,
            source: IMAGE_ERASE_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueImageEraseJob,
    });
  }
}
