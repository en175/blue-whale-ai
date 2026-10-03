// IKGXM1：图片抠图建任务服务（仿 image-erasures 的免费轻量入口，契约 image-cutout 章节）。
// 校验源图片资产归属与场景合法性 → 复核输入门槛（按场景两档分辨率 / 大小 / 格式，宽高 null 放行）
// → 插 generation_jobs(type=image_cutout)。
// 免费口径（同 image-erasures / image-enhancements）：不写成本预留、不接成本估算、不走余额拦截门。
// 不写画布——抠图结果卡由前端发送任务时本地插入，产物经 GET /api/jobs/:id 的 asset 按 target_node_id 回填。
// IKJJQW（B.3）：创建入口接入恢复协议 v1——canvas_binding 随 body 提交（剥离后不进业务 zod），
// Idempotency-Key 头承载 submission_id；受理走共享受理段（media-tool-recovery）。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  IMAGE_CUTOUT_INPUT_FORMATS,
  IMAGE_CUTOUT_INPUT_KEYS,
  IMAGE_CUTOUT_JOB_TYPE,
  IMAGE_CUTOUT_MAX_FILE_BYTES,
  IMAGE_CUTOUT_SCENE_SIZE_LIMITS,
  IMAGE_CUTOUT_SOURCE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  imageCutoutInputSchema,
  ok,
  type ImageCutoutInput,
} from "@lib/contracts";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import {
  createMediaToolJobWithRecovery,
  mediaToolRequestHash,
  readAcceptedMediaToolReplay,
  renderMediaToolReplay,
  stripCanvasBinding,
  type MediaToolRecovery,
} from "@lib/shared/generation/media-tool-recovery.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** IKJJQW：恢复协议受理的幂等域（先例命名「领域.动作」）。 */
const IDEMPOTENCY_OPERATION = "image_cutout.create";
const REQUEST_PATH = "/image-cutouts";

/** zod 校验失败 → 人能读懂的原因（按首个出错键名映射；前端置灰只是体验层，这里返回可读文案）。 */
const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [IMAGE_CUTOUT_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [IMAGE_CUTOUT_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [IMAGE_CUTOUT_INPUT_KEYS.cutoutScene]: "抠图场景仅支持 general / human / product",
  [IMAGE_CUTOUT_INPUT_KEYS.needContour]: "人像/商品场景缺少主体描边开关（need_contour）",
  [IMAGE_CUTOUT_INPUT_KEYS.contourColor]: "描边颜色固定 #FFFFFF（contour_color）",
  [IMAGE_CUTOUT_INPUT_KEYS.contourSize]: "描边宽度需为 1~100 的整数（contour_size）",
  [IMAGE_CUTOUT_INPUT_KEYS.needCropBackground]: "人像/商品场景缺少透明背景裁剪开关（need_crop_background）",
};

/** 人像/商品场景增强键（通用场景 strict 分支无此四键，传入即拒——规格故事 29）。 */
const SUBJECT_SCENE_KEYS: readonly string[] = [
  IMAGE_CUTOUT_INPUT_KEYS.needContour,
  IMAGE_CUTOUT_INPUT_KEYS.contourColor,
  IMAGE_CUTOUT_INPUT_KEYS.contourSize,
  IMAGE_CUTOUT_INPUT_KEYS.needCropBackground,
];

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    // general 分支无描边/裁剪四键（契约 strict）：通用场景带增强参数在此拦截。
    if (first.keys?.some((key) => SUBJECT_SCENE_KEYS.includes(key))) {
      return "通用场景不支持传描边与透明裁剪参数（need_contour / contour_color / contour_size / need_crop_background）";
    }
    return "请求包含不支持的参数，仅允许抠图任务的 source_asset_id / target_node_id / cutout_scene（人像/商品场景另带描边与裁剪四键）";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

/** 从素材 mime（优先，DB 记录上传时的权威值）或 URL / 存储键扩展名取格式 token（小写）。
 *  上传与生成资产的存储键都带真实扩展名（tos-storage.ts presign / worker TosMediaStorage），
 *  两处都取不到 → null。webp/gif 等 token 不在白名单内由调用方拒。 */
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
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
    // 与图片生成同构（handle-create-generation-job.ts 的 internal 形参）：请求方 sk- 凭证冻结进 job。
    internal: { providerCredential?: string } = {},
    // IKJJQW（B.3）：新协议承载——Idempotency-Key 头必须等于 canvas_binding.submission_id。
    idempotencyKey?: string,
  ) {
    // IKJJQW：canvas_binding 是业务键之上的基础设施键（同 client_token 口径）：先行剥离再过
    // 契约 schema；携带但非法 / 与 Idempotency-Key 承载不一致 → 400 invalid_recovery_payload
    // （IKJLTZ：三段校验收敛至 stripCanvasBinding，头承载的 trim 口径留在调用方）。
    const gate = stripCanvasBinding(body ?? {}, "Idempotency-Key", (idempotencyKey ?? "").trim());
    if (gate.error) return gate.error;
    const { binding, rest } = gate;

    // 契约 schema 复核（按场景 strict 分支）：场景枚举、通用场景禁带 / 人像商品必带增强四键在此拦截。
    const parsed = imageCutoutInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: ImageCutoutInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job 与原关联，不因此刻素材已删除/门槛不过而重新拒绝或重复受理。
    // 摘要只依赖请求载荷与 canvas_binding（mediaToolRequestHash），与可变状态无关。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: IMAGE_CUTOUT_JOB_TYPE,
          operation: IDEMPOTENCY_OPERATION,
          requestHash: mediaToolRequestHash(IDEMPOTENCY_OPERATION, projectId, REQUEST_PATH, body ?? {}),
          binding,
        }
      : null;
    const replay = recovery
      ? await readAcceptedMediaToolReplay(this.prisma.client, recovery)
      : null;
    if (replay) return renderMediaToolReplay(replay);

    // findOwnedSource 按 user_id 归属过滤（status=normal 且未删除）：非本人素材一律 404，不泄露存在性。
    const asset = await this.assets.findOwnedSource(
      input[IMAGE_CUTOUT_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "image") {
      return fail(FAILURE_CODE, "仅支持对图片资产发起抠图");
    }

    // 输入门槛复核（官方 PDF 输入限制，与擦除的差异点：分辨率上限按场景两档——
    // general 长边 ≤10240 / 短边 ≤6000 / 总像素 ≤40MP；human|product 长边 ≤7680 / 短边 ≤4320，
    // 官方未给该档总像素上限，不设。上限常量单源在契约 IMAGE_CUTOUT_SCENE_SIZE_LIMITS，
    // web 发送前按所选场景精校同源（规格故事 15）；竖图横图同口径（长边 = max、短边 = min））。
    // assets.width/height 由前端上报、存量图大量为 null：缺权威尺寸不臆造、不拦——放行交供应商
    // 按官方门槛拒（与擦除/高清同口径）。
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

    // 契约 schema parse 后原样冻结（重试原样沿用）。
    // provider_credential 是业务键之上的基础设施键（不进契约 zod——它校验的是客户端 payload，
    // 凭证由服务端注入）：与图片生成 / 擦除同构，请求方 sk- 明文冻结进 job input，
    // worker（ImageCutoutJobProcessor）处理时直接取用；未携带/非 sk- 时不写键。
    const frozenInput: ImageCutoutInput & { provider_credential?: string } = {
      ...input,
      ...(internal.providerCredential
        ? { provider_credential: internal.providerCredential }
        : {}),
    };

    // IKJJQW：受理主体走共享段（B.3）——有 canvas_binding 时「恢复锁序核对 → 建行 → 关联行 →
    // 幂等行」一个事务；无 canvas_binding 时建行路径与接入前一致。前置回读 miss 后此处
    // 事务内仍有锁内回读兜底（并发赢家在锁外 miss 与事务开始之间提交的情形）。
    const outcome = await createMediaToolJobWithRecovery(
      this.prisma.client,
      recovery,
      async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: IMAGE_CUTOUT_JOB_TYPE,
            source: IMAGE_CUTOUT_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            // 过去 60s：回拨口径同 media_extract——DATETIME(0) 秒精度进位会让同秒 claim 的 lte now 判 false。
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

  /** 入队失败兜底：queued 任务直接置 failed，避免抠图任务在 worker 恢复扫描接管前静默悬挂。
   *  IKBQEE / ADR-0078：details 落调试原文，禁展示用户。逻辑在 repo.markFailedQueued（IKDZGH 收敛）。 */
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
