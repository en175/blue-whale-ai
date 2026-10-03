// IKGM99：图片高清放大建任务服务（仿 media-extractions 的免费轻量入口，契约 §14）。
// 校验源图片资产归属与参数合法性 → 复核版本档能力矩阵与源图尺寸门槛 → 插 generation_jobs(type=image_enhance)。
// 免费口径（§14.1）：不写成本预留、不接成本估算、不走余额拦截门、不走素材库合规门。
// 不写画布——高清卡由前端建任务前本地插入，产物经 GET /api/jobs/:id 的 asset 按 target_node_id 回填。
// IKJJQW（B.3）：创建入口接入恢复协议 v1——canvas_binding 随 body 提交（剥离后不进业务 zod），
// Idempotency-Key 头承载 submission_id；受理走共享受理段（media-tool-recovery）。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  IMAGE_ENHANCE_DEFAULTS,
  IMAGE_ENHANCE_INPUT_KEYS,
  IMAGE_ENHANCE_JOB_TYPE,
  IMAGE_ENHANCE_SOURCE,
  IMAGE_ENHANCE_TIER_CAPABILITY,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  imageEnhanceInputSchema,
  imageEnhanceTierSizeGate,
  ok,
  type ImageEnhanceInput,
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
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** IKJJQW：恢复协议受理的幂等域（先例命名「领域.动作」）。 */
const IDEMPOTENCY_OPERATION = "image_enhance.create";
const REQUEST_PATH = "/image-enhancements";

/** zod 校验失败 → 人能读懂的原因（按首个出错键名映射；前端预检只是体验层，这里返回可读文案）。 */
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

    // 契约 schema 复核（六键 strict）：版本档枚举、倍数 ∈ 2/4/6 等结构合法性在此拦截。
    const parsed = imageEnhanceInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: ImageEnhanceInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job 与原关联，不因此刻素材已删除/门槛不过而重新拒绝或重复受理。
    // 摘要只依赖请求载荷与 canvas_binding（mediaToolRequestHash），与可变状态无关。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: IMAGE_ENHANCE_JOB_TYPE,
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
      input[IMAGE_ENHANCE_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "image") {
      return fail(FAILURE_CODE, "仅支持对图片资产发起高清放大");
    }

    // 版本档能力矩阵复核（§14.3，与前端置灰 / worker 出站裁剪三处同源）。
    // 「带」的口径：色彩校正是开关，true=开启即「带」；增强策略无关闭值，非默认值=显式选择即「带」，
    // 契约 §14.2 钦定置灰档仍冻结默认值（占位），默认值组合放行、显式激活组合拒绝。
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

    // 源图尺寸门槛复核。assets.width/height 由前端上报、后端原样存，存量图大量为 null（IKE53U 实测）；
    // 缺权威尺寸时不臆造、不拦存量图——放行交供应商按官方门槛拒（用户故事 30 预期的兜底路径）。
    // 门槛数值与判定在契约 imageEnhanceTierSizeGate 单处定义（web 面板预检同源引用）。
    if (asset.width != null && asset.height != null) {
      const sizeError = imageEnhanceTierSizeGate(
        input.version_tier,
        asset.width,
        asset.height,
      );
      if (sizeError) return fail(FAILURE_CODE, sizeError);
    }

    // 契约 schema parse 后原样冻结（六键恒在、重试原样沿用，§14.2）。
    // provider_credential 是六键之上的基础设施键（不进契约 zod——它校验的是客户端 payload，
    // 凭证由服务端注入）：与图片生成同构（handle-create-generation-job.ts 修正四，凭证去密），
    // 请求方 sk- 明文冻结进 job input，worker（ImageEnhanceJobProcessor）处理时直接取用；
    // 未携带/非 sk- 时不写键。契约 strict 六键口径不变。
    const frozenInput: ImageEnhanceInput & { provider_credential?: string } = {
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
            type: IMAGE_ENHANCE_JOB_TYPE,
            source: IMAGE_ENHANCE_SOURCE,
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

  /** 入队失败兜底：queued 任务直接置 failed，避免高清放大任务在 worker 恢复扫描接管前静默悬挂。
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
