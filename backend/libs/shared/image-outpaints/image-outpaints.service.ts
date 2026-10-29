import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IMAGE_OUTPAINT_INPUT_KEYS,
  IMAGE_OUTPAINT_JOB_TYPE,
  IMAGE_OUTPAINT_SOURCE,
  PARAM_MISSING_CODE,
  fail,
  imageOutpaintInputSchema,
  imageOutpaintSourceGate,
  type ImageOutpaintInput,
} from "@lib/contracts";
import {
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { enqueueImageOutpaintJob } from "@lib/shared/generation/generation-queue.js";
import { submitMediaToolJob } from "@lib/shared/media-tools/media-tool-submission.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import {
  probeImageDimensions,
  type ImageDimensions,
} from "@lib/shared/assets/image-dimensions.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  requireOwnedProject,
  resolveOwnedMediaSource,
} from "@lib/shared/media-tools/owned-media-source.js";

const IDEMPOTENCY_OPERATION = "image_outpaint.create";
const REQUEST_PATH = "/image-outpaints";

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [IMAGE_OUTPAINT_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [IMAGE_OUTPAINT_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [IMAGE_OUTPAINT_INPUT_KEYS.expandTop]: "上方扩展比例需在 0 至 0.4 之间",
  [IMAGE_OUTPAINT_INPUT_KEYS.expandBottom]: "下方扩展比例需在 0 至 0.4 之间",
  [IMAGE_OUTPAINT_INPUT_KEYS.expandLeft]: "左侧扩展比例需在 0 至 0.4 之间",
  [IMAGE_OUTPAINT_INPUT_KEYS.expandRight]: "右侧扩展比例需在 0 至 0.4 之间",
};

function readableParseError(
  issues: readonly {
    code: string;
    message?: string;
    path: readonly (string | number | symbol)[];
  }[],
): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许扩图的六个参数键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  if (!key && first?.message) return first.message;
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

@Injectable()
export class ImageOutpaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
    private readonly storage: AssetStorageService,
    private readonly billing: MediaToolBillingService,
  ) {}

  private async probeAndBackfillDimensions(
    assetId: string,
    storageKey: string | null,
  ): Promise<ImageDimensions | null> {
    const uploads = this.storage.uploads;
    if (!uploads || !storageKey) return null;
    const probed = await probeImageDimensions(uploads, storageKey);
    if (!probed) return null;
    try {
      await this.prisma.client.user_assets.update({
        where: { id: BigInt(assetId) },
        data: { width: probed.width, height: probed.height },
      });
    } catch {
    }
    return probed;
  }

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ) {
    const gate = stripCanvasBinding(body ?? {}, "Idempotency-Key", (idempotencyKey ?? "").trim());
    if (gate.error) return gate.error;
    const { binding, rest } = gate;

    const parsed = imageOutpaintInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: ImageOutpaintInput = parsed.data;

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
      taskType: IMAGE_OUTPAINT_JOB_TYPE,
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
      assetId: input[IMAGE_OUTPAINT_INPUT_KEYS.sourceAssetId],
      expectedTypes: ["image"],
      wrongTypeMessage: "仅支持对图片资产发起扩图",
    });
    if (!source.ok) return source.envelope;
    const asset = source.asset;

    let gateWidth = asset.width;
    let gateHeight = asset.height;
    if (gateWidth == null || gateHeight == null) {
      const probed = await this.probeAndBackfillDimensions(
        input[IMAGE_OUTPAINT_INPUT_KEYS.sourceAssetId],
        asset.storage_key,
      );
      if (probed) {
        gateWidth = probed.width;
        gateHeight = probed.height;
      }
    }
    const gateError = imageOutpaintSourceGate(
      gateWidth,
      gateHeight,
      asset.size != null ? Number(asset.size) : null,
    );
    if (gateError) return fail(FAILURE_CODE, gateError);

    const frozenInput: ImageOutpaintInput = { ...input };

    return submitMediaToolJob({
      prisma: this.prisma.client,
      billing: this.billing,
      toolType: IMAGE_OUTPAINT_JOB_TYPE,
      userId,
      input: frozenInput,
      recovery,
      legacy,
      createJob: async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: IMAGE_OUTPAINT_JOB_TYPE,
            source: IMAGE_OUTPAINT_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      enqueue: enqueueImageOutpaintJob,
    });
  }
}
