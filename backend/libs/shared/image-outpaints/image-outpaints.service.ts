// IKGOQV：画布图片扩图建任务服务（仿 image-enhancements 的免费轻量入口，契约 image-outpaint.ts）。
// 校验源图片资产归属与参数合法性 → 复核源图门槛（长边/大小/真实宽高）→ 插 generation_jobs(type=image_outpaint)。
// 免费口径（同 image_enhance）：不写成本预留、不接成本估算、不走余额拦截门、不走素材库合规门。
// 不写画布——扩图结果卡由前端建任务前本地插入，产物经 GET /api/jobs/:id 的 asset 按 target_node_id 回填。
// IKJJQW（B.3）：创建入口接入恢复协议 v1——canvas_binding 随 body 提交（剥离后不进业务 zod），
// Idempotency-Key 头承载 submission_id；受理走共享受理段（media-tool-recovery）。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  IMAGE_OUTPAINT_INPUT_KEYS,
  IMAGE_OUTPAINT_JOB_TYPE,
  IMAGE_OUTPAINT_PROVIDER_CREDENTIAL_KEY,
  IMAGE_OUTPAINT_SOURCE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  imageOutpaintInputSchema,
  imageOutpaintSourceGate,
  ok,
  type ImageOutpaintInput,
} from "@lib/contracts";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import {
  createMediaToolJobWithRecovery,
  mediaToolRequestHash,
  readAcceptedMediaToolReplay,
  renderMediaToolReplay,
  takeCanvasBinding,
  type MediaToolRecovery,
} from "@lib/shared/generation/media-tool-recovery.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import {
  probeImageDimensions,
  type ImageDimensions,
} from "@lib/shared/assets/image-dimensions.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** IKJJQW：恢复协议受理的幂等域（先例命名「领域.动作」）。 */
const IDEMPOTENCY_OPERATION = "image_outpaint.create";
const REQUEST_PATH = "/image-outpaints";

/** zod 校验失败 → 人能读懂的原因（按首个出错键名映射；前端预检只是体验层，这里返回可读文案）。 */
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
  // schema 级 refine（四比例全零）无键名路径，直接透出 refine 文案。
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
  ) {}

  /** 缺尺寸资产：Range 读文件头探测真实宽高，探测成功即回填资产行（后续请求直接命中）。
   *  探测不可用/失败都不阻断主流程——返回 null 落回缺尺寸拒绝，行为与修订前一致。 */
  private async probeAndBackfillDimensions(
    assetId: string,
    storageKey: string | null,
  ): Promise<ImageDimensions | null> {
    const uploads = this.storage.uploads;
    if (!uploads || !storageKey) return null;
    const probed = await probeImageDimensions(uploads, storageKey);
    if (!probed) return null;
    try {
      await this.prisma.client.assets.update({
        where: { id: BigInt(assetId) },
        data: { width: probed.width, height: probed.height },
      });
    } catch {
      // 回填失败只丢一次优化：本次复核照用探测值，下次请求还会再探测。
    }
    return probed;
  }

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
    // 与图片生成/高清放大同构：请求方 sk- 凭证由 controller 注入、冻结进 job input。
    internal: { providerCredential?: string } = {},
    // IKJJQW（B.3）：新协议承载——Idempotency-Key 头必须等于 canvas_binding.submission_id。
    idempotencyKey?: string,
  ) {
    // IKJJQW：canvas_binding 是业务键之上的基础设施键（同 client_token 口径）：先行剥离再过
    // 契约 schema；携带但非法 / 与 Idempotency-Key 承载不一致 → 400 invalid_recovery_payload。
    const { binding, rest, invalid } = takeCanvasBinding(body ?? {});
    if (invalid) {
      return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
    }
    if (binding && (idempotencyKey ?? "").trim() !== binding.submission_id) {
      return fail(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", {
        reason: RECOVERY_REASONS.invalidPayload,
      });
    }

    // 契约 schema 复核（六键 strict）：四比例值域 [0, 0.4] 且至少一项 > 0 在此拦截。
    const parsed = imageOutpaintInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: ImageOutpaintInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job 与原关联，不因此刻素材已删除/门槛不过而重新拒绝或重复受理。
    // 摘要只依赖请求载荷与 canvas_binding（mediaToolRequestHash），与可变状态无关。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: IMAGE_OUTPAINT_JOB_TYPE,
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
      input[IMAGE_OUTPAINT_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "image") {
      return fail(FAILURE_CODE, "仅支持对图片资产发起扩图");
    }

    // 源图门槛复核（长边 ≤4160px、文件 ≤10MB、真实宽高必须已知——与高清放大「缺尺寸放行」相反：
    // 扩展比例相对原图短边换算，缺尺寸无法预检 40% 上限）。
    // 资产宽高缺失时（画布/资产库上传路径历史上不上报尺寸，库存约四成图片如此）先从对象存储
    // 探测真实宽高并回填资产行，探测不到才落回缺尺寸拒绝（IKGOQ0 验收修订：探测回填口径）。
    // 门槛数值与判定在契约 imageOutpaintSourceGate 单处定义（web 菜单项预检同源引用）。
    // size 是 prisma BigInt（10MB 上限内 Number 转换无损）；gate 同时服务 web 前端，签名保持 number。
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

    // 契约 schema parse 后原样冻结（六键恒在、重试原样沿用）。provider_credential 是六键之上的
    // 基础设施键（不进契约 zod——它校验的是客户端 payload，凭证由服务端注入）：与图片生成/高清放大
    // 同构，请求方 sk- 明文冻结进 job input，worker（ImageOutpaintJobProcessor）处理时直接取用；
    // 未携带/非 sk- 时不写键。键名用契约常量，防字面量漂移。契约 strict 六键口径不变。
    const frozenInput: ImageOutpaintInput & { provider_credential?: string } = {
      ...input,
      ...(internal.providerCredential
        ? {
            [IMAGE_OUTPAINT_PROVIDER_CREDENTIAL_KEY]:
              internal.providerCredential,
          }
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
            type: IMAGE_OUTPAINT_JOB_TYPE,
            source: IMAGE_OUTPAINT_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            // 过去 60s：回拨口径同 image_enhance——DATETIME(0) 秒精度进位会让同秒 claim 的 lte now 判 false。
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

  /** 入队失败兜底：queued 任务直接置 failed，避免扩图任务在 worker 恢复扫描接管前静默悬挂。
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
