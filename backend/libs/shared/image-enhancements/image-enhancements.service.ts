import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IMAGE_ENHANCE_DEFAULTS,
  IMAGE_ENHANCE_INPUT_KEYS,
  IMAGE_ENHANCE_JOB_TYPE,
  IMAGE_ENHANCE_SOURCE,
  IMAGE_ENHANCE_TIER_CAPABILITY,
  PARAM_MISSING_CODE,
  fail,
  imageEnhanceInputSchema,
  imageEnhanceTierSizeGate,
  type ImageEnhanceInput,
} from "@lib/contracts";
import {
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueImageEnhanceJob } from "@lib/shared/generation/generation-queue.js";
import { submitMediaToolJob } from "@lib/shared/media-tools/media-tool-submission.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  requireOwnedProject,
  resolveOwnedMediaSource,
} from "@lib/shared/media-tools/owned-media-source.js";

const IDEMPOTENCY_OPERATION = "image_enhance.create";
const REQUEST_PATH = "/image-enhancements";

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [IMAGE_ENHANCE_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [IMAGE_ENHANCE_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [IMAGE_ENHANCE_INPUT_KEYS.versionTier]: "版本档仅支持 lite / pro / max",
  [IMAGE_ENHANCE_INPUT_KEYS.multiple]: "放大倍数仅支持 2 / 4 / 6",
  [IMAGE_ENHANCE_INPUT_KEYS.generativeEnhanceMode]:
    "增强策略仅支持 fidelity_first / generative_first",
  [IMAGE_ENHANCE_INPUT_KEYS.enableCorrectColor]: "色彩校正开关（enable_correct_color）必须为布尔值",
};

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许高清放大的六个参数键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

@Injectable()
export class ImageEnhancementsService {
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

    const parsed = imageEnhanceInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: ImageEnhanceInput = parsed.data;

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
      taskType: IMAGE_ENHANCE_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
      idempotencyKey,
    });
    if (replayed) return replayed;

    const source = await resolveOwnedMediaSource({
      prisma: this.prisma.client,
      assets: this.assets,
      userId,
      assetId: input[IMAGE_ENHANCE_INPUT_KEYS.sourceAssetId],
      expectedTypes: ["image"],
      wrongTypeMessage: "仅支持对图片资产发起高清放大",
    });
    if (!source.ok) return source.envelope;
    const asset = source.asset;

    const capability = IMAGE_ENHANCE_TIER_CAPABILITY[input.version_tier];
    if (input.enable_correct_color && !capability.correctColor) {
      return fail(FAILURE_CODE, "当前版本档不支持色彩校正，请切换到 Max 版本或关闭色彩校正");
    }
    if (
      !capability.enhanceMode &&
      input.generative_enhance_mode !== IMAGE_ENHANCE_DEFAULTS.generativeEnhanceMode
    ) {
      return fail(FAILURE_CODE, "Lite 版本不支持选择增强策略，请切换到 Pro 或 Max 版本");
    }

    if (asset.width != null && asset.height != null) {
      const sizeError = imageEnhanceTierSizeGate(
        input.version_tier,
        asset.width,
        asset.height,
      );
      if (sizeError) return fail(FAILURE_CODE, sizeError);
    }

    const frozenInput: ImageEnhanceInput = { ...input };

    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: IMAGE_ENHANCE_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      legacy,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: IMAGE_ENHANCE_JOB_TYPE,
            source: IMAGE_ENHANCE_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueImageEnhanceJob,
    });
  }
}
