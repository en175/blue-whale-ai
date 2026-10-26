import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IMAGE_CUTOUT_INPUT_FORMATS,
  IMAGE_CUTOUT_INPUT_KEYS,
  IMAGE_CUTOUT_JOB_TYPE,
  IMAGE_CUTOUT_MAX_FILE_BYTES,
  IMAGE_CUTOUT_SCENE_SIZE_LIMITS,
  IMAGE_CUTOUT_SOURCE,
  PARAM_MISSING_CODE,
  fail,
  imageCutoutInputSchema,
  type ImageCutoutInput,
} from "@lib/contracts";
import {
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueImageCutoutJob } from "@lib/shared/generation/generation-queue.js";
import { submitMediaToolJob } from "@lib/shared/media-tools/media-tool-submission.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  requireOwnedProject,
  resolveOwnedMediaSource,
} from "@lib/shared/media-tools/owned-media-source.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";

const IDEMPOTENCY_OPERATION = "image_cutout.create";
const REQUEST_PATH = "/image-cutouts";

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [IMAGE_CUTOUT_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [IMAGE_CUTOUT_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [IMAGE_CUTOUT_INPUT_KEYS.cutoutScene]: "抠图场景仅支持 general / human / product",
  [IMAGE_CUTOUT_INPUT_KEYS.needContour]: "人像/商品场景缺少主体描边开关（need_contour）",
  [IMAGE_CUTOUT_INPUT_KEYS.contourColor]: "描边颜色固定 #FFFFFF（contour_color）",
  [IMAGE_CUTOUT_INPUT_KEYS.contourSize]: "描边宽度需为 1~100 的整数（contour_size）",
  [IMAGE_CUTOUT_INPUT_KEYS.needCropBackground]: "人像/商品场景缺少透明背景裁剪开关（need_crop_background）",
};

const SUBJECT_SCENE_KEYS: readonly string[] = [
  IMAGE_CUTOUT_INPUT_KEYS.needContour,
  IMAGE_CUTOUT_INPUT_KEYS.contourColor,
  IMAGE_CUTOUT_INPUT_KEYS.contourSize,
  IMAGE_CUTOUT_INPUT_KEYS.needCropBackground,
];

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    if (first.keys?.some((key) => SUBJECT_SCENE_KEYS.includes(key))) {
      return "通用场景不支持传描边与透明裁剪参数（need_contour / contour_color / contour_size / need_crop_background）";
    }
    return "请求包含不支持的参数，仅允许抠图任务的 source_asset_id / target_node_id / cutout_scene（人像/商品场景另带描边与裁剪四键）";
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
export class ImageCutoutsService {
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

    const parsed = imageCutoutInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: ImageCutoutInput = parsed.data;

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
      taskType: IMAGE_CUTOUT_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
    });
    if (replayed) return replayed;

    const source = await resolveOwnedMediaSource({
      prisma: this.prisma.client,
      assets: this.assets,
      userId,
      assetId: input[IMAGE_CUTOUT_INPUT_KEYS.sourceAssetId],
      expectedTypes: ["image"],
      wrongTypeMessage: "仅支持对图片资产发起抠图",
    });
    if (!source.ok) return source.envelope;
    const asset = source.asset;

    if (asset.width != null && asset.height != null) {
      const scene = input[IMAGE_CUTOUT_INPUT_KEYS.cutoutScene];
      const limits = IMAGE_CUTOUT_SCENE_SIZE_LIMITS[scene];
      const longSide = Math.max(asset.width, asset.height);
      const shortSide = Math.min(asset.width, asset.height);
      if (longSide > limits.maxLongSide || shortSide > limits.maxShortSide) {
        return fail(
          FAILURE_CODE,
          `当前场景（${scene}）图片长边超过 ${limits.maxLongSide} 或短边超过 ${limits.maxShortSide} 像素上限，无法抠图`,
        );
      }
      if (limits.maxTotalPixels != null && longSide * shortSide > limits.maxTotalPixels) {
        return fail(
          FAILURE_CODE,
          `当前场景（${scene}）图片总像素超过 ${limits.maxTotalPixels / 1_000_000}MP 上限，无法抠图`,
        );
      }
    }
    if (asset.size != null && asset.size > IMAGE_CUTOUT_MAX_FILE_BYTES) {
      return fail(FAILURE_CODE, `图片大小超过 ${IMAGE_CUTOUT_MAX_FILE_BYTES / (1024 * 1024)}MB 上限，无法抠图`);
    }
    const format = detectAssetFormat(asset);
    if (!format || !(IMAGE_CUTOUT_INPUT_FORMATS as readonly string[]).includes(format)) {
      return fail(FAILURE_CODE, `仅支持 ${IMAGE_CUTOUT_INPUT_FORMATS.join(" / ")} 格式的图片发起抠图`);
    }

    const frozenInput: ImageCutoutInput = { ...input };
    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: IMAGE_CUTOUT_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: IMAGE_CUTOUT_JOB_TYPE,
            source: IMAGE_CUTOUT_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueImageCutoutJob,
    });
  }
}
