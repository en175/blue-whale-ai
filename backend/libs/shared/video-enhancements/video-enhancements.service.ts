// IKH3VE：视频 HD 高清（火山 MediaKit 画质增强大模型版）建任务服务（仿 video-subtitle-erasures
// 的免费轻量入口，契约 @lib/contracts/video-enhance）。校验源视频资产归属 → 复核输入门槛
// （短边 [360,1080] / 长边 ≤1920，宽高 null 放行）→ 插 generation_jobs(type=video_enhance)。
// 免费口径（同去字幕 / media-extractions）：不写成本预留、不接成本估算、不走余额拦截门。
// 不写画布——HD 高清卡由前端进入工具时本地建卡（ADR-0105 建卡口径照抄图片高清放大），
// 产物经 GET /api/jobs/:id 的 asset 按 target_node_id 回填（源卡不动，结果回填本卡）。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_ENHANCE_INPUT_KEYS,
  VIDEO_ENHANCE_JOB_TYPE,
  VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX,
  VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_SOURCE,
  fail,
  ok,
  videoEnhanceInputSchema,
  type VideoEnhanceInput,
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
const IDEMPOTENCY_OPERATION = "video_enhance.create";
const REQUEST_PATH = "/video-enhancements";

/** zod 校验失败 → 人能读懂的原因（按首个出错键名映射；前端置灰只是体验层，这里返回可读文案）。 */
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
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
    // 与去字幕同构（video-subtitle-erasures.service.ts 的 internal 形参）：请求方 sk- 凭证冻结进 job。
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

    // 契约 schema 复核（strict 三键）：resolution 枚举（720p 已被产品裁掉）在此拦截。
    const parsed = videoEnhanceInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoEnhanceInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job 与原关联，不因此刻素材已删除/门槛不过而重新拒绝或重复受理。
    // 摘要只依赖请求载荷与 canvas_binding（mediaToolRequestHash），与可变状态无关。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: VIDEO_ENHANCE_JOB_TYPE,
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
      input[VIDEO_ENHANCE_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持对视频资产发起 HD 高清");
    }

    // 输入门槛复核（官方 PDF 输入视频限制：短边 [360,1080]、长边 [360,1920]；短边/长边语义：
    // 取宽高较小者为短边、较大者为长边，竖屏 1080x1920 合法；常量单源在契约 video-enhance.ts，
    // web 按钮门槛预检同源）。长边下限 360 由短边下限蕴含（长边 ≥ 短边），不单独判。
    // assets.width/height 由前端上报、存量大量为 null：缺权威值不臆造、不拦——放行交供应商按
    // 官方门槛拒（与去字幕 / 擦除 / 高清同口径）；仅 SDR 的限制无前置元数据，同由任务失败口径兜底。
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

    // 契约 schema parse 后原样冻结（重试原样沿用）。
    // provider_credential 是业务键之上的基础设施键（不进契约 zod——它校验的是客户端 payload，
    // 凭证由服务端注入）：与去字幕 / media_extract 同构，请求方 sk- 明文冻结进 job input，
    // worker（后续票按附录 C 注册的处理器）处理时直接取用；未携带/非 sk- 时不写键。
    const frozenInput: VideoEnhanceInput & { provider_credential?: string } = {
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
            type: VIDEO_ENHANCE_JOB_TYPE,
            source: VIDEO_ENHANCE_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            // 过去 60s：回拨口径同 media_extract / 去字幕——DATETIME(0) 秒精度进位会让同秒
            // claim 的 lte now 判 false。
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

  /** 入队失败兜底：queued 任务直接置 failed，避免 HD 高清任务在 worker 领取前静默悬挂。
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
