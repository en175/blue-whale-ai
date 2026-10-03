// IKHLK3：视频插帧（火山 MediaKit video-frame-interpolation）建任务服务（仿 video-enhancements
// 的免费轻量入口，契约 @lib/contracts/video-frame-interpolation）。
// 校验源视频资产归属 → 插 generation_jobs(type=video_frame_interpolation)。口径差异（父需求 IKHLES /
// ADR-0113）：**不做输入分辨率门槛复核**（官方对该端点无分辨率/时长限制，与 HD 高清的短边/长边
// 门槛不同源）、**不做「目标帧率不超过原片 4 倍」前置拦截**（仓内全链无 fps 元数据、源帧率不可知，
// 官方为建议非硬限，越界由任务失败口径兜底）、fps 缺省补默认 60（契约 schema 承担）。
// 免费口径（同去字幕 / HD / 音视频分离）：不写成本预留、不接成本估算、不走余额拦截门。
// 不写画布——插帧卡由前端进入工具时本地建卡（ADR-0113 建卡口径照抄 HD 高清），产物经
// GET /api/jobs/:id 的 asset 按 target_node_id 回填（源卡不动，结果回填本卡）。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS,
  VIDEO_FRAME_INTERPOLATION_FPS_VALUES,
  VIDEO_FRAME_INTERPOLATION_INPUT_KEYS,
  VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
  VIDEO_FRAME_INTERPOLATION_SOURCE,
  fail,
  ok,
  videoFrameInterpolationInputSchema,
  videoFrameInterpolationRecoveryQuerySchema,
  type VideoFrameInterpolationInput,
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
const IDEMPOTENCY_OPERATION = "video_frame_interpolation.create";
const REQUEST_PATH = "/video-frame-interpolations";

/** zod 校验失败 → 人能读懂的原因（按首个出错键名映射；前端置灰只是体验层，这里返回可读文案）。 */
const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.sourceAssetId]:
    "缺少或非法的源素材 ID（source_asset_id）",
  [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.fps]: `目标帧率仅支持 ${VIDEO_FRAME_INTERPOLATION_FPS_VALUES.join(
    " / ",
  )}（缺省按 ${VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS} 处理）`,
};

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许视频插帧任务的 source_asset_id / target_node_id / fps 键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

@Injectable()
export class VideoFrameInterpolationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
    // 与 HD 高清同构（video-enhancements.service.ts 的 internal 形参）：请求方 sk- 凭证冻结进 job。
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

    // 契约 schema 复核（strict 三键）：fps 枚举外（含官方合法但产品未暴露的 45）与字符串 "60" 在此拦截；
    // fps 缺省时由 schema 补默认 60（**与 HD 高清 resolution 必填口径不同**，父单决策口径）。
    const parsed = videoFrameInterpolationInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoFrameInterpolationInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job 与原关联，不因此刻素材已删除/门槛不过而重新拒绝或重复受理。
    // 摘要只依赖请求载荷与 canvas_binding（mediaToolRequestHash），与可变状态无关。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
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
      input[VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持对视频资产发起视频插帧");
    }

    // 输入门槛：**无**。官方对该端点只给帧率取值范围 [15,120]（本仓产品面已收窄为 30/60/120 三档）
    // 与「建议不超过原片 4 倍」（建议非硬限、源帧率不可知，ADR-0113 不做前置）；分辨率与码率跟随
    // 原片（官方「插帧不改变视频的分辨率与码率」），故不照搬 HD 高清的短边/长边门槛；官方未给出
    // 时长与文件大小上限（见 docs/specs/2026-09-21-video-frame-interpolation-mediakit.md），
    // 交供应商按官方限制拒（与去字幕 / HD 同口径：缺权威值不臆造、不拦）。

    // 契约 schema parse 后原样冻结（重试原样沿用；fps 缺省已补默认值，落库恒为三档之一）。
    // provider_credential 是业务键之上的基础设施键（不进契约 zod——它校验的是客户端 payload，
    // 凭证由服务端注入）：与去字幕 / HD 同构，请求方 sk- 明文冻结进 job input，
    // worker（IKHLKJ 按附录 C 注册的处理器）处理时直接取用；未携带/非 sk- 时不写键。
    const frozenInput: VideoFrameInterpolationInput & { provider_credential?: string } = {
      ...input,
      ...(internal.providerCredential
        ? { provider_credential: internal.providerCredential }
        : {}),
    };

    // job 先落库再投递（父单验收：创建后关页面不丢 job，任务可经既有 GET /api/jobs/:id 查询）。
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
            type: VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
            source: VIDEO_FRAME_INTERPOLATION_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            // 过去 60s：回拨口径同 media_extract / 去字幕 / HD 高清——DATETIME(0) 秒精度进位会让同秒
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

  /** 入队失败兜底：queued 任务直接置 failed，避免插帧任务在 worker 领取前静默悬挂。
   *  IKBQEE / ADR-0078：details 落调试原文，禁展示用户（对客文案固定「任务入队失败，请重试」）。
   *  逻辑在 repo.markFailedQueued（IKDZGH 收敛）。 */
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

  /** 恢复查询（IKHSFE）：浏览器未收到创建响应就关页时，按「项目 + 目标节点」查回当前任务
   *  的权威关联，供重新进入画布恢复。契约 = video-frame-interpolation.ts 的恢复查询节
   *  （RECOVERY_* 常量与 schema）。
   *  - 归属：先 project.findOwnedById 复核（非本人项目一律 404，不泄露存在性）；
   *  - 判定：同 user + project + target_node_id 的未软删任务中 gmt_create/id 最新者为当前关联
   *    （旧任务不得覆盖更新关联，不同卡互不串联），**不过滤 status**——入队失败兜底置 failed
   *    的任务同样可查回；
   *  - 外泄面：响应只回 job_id / status / progress / created_at，**不回 input**——
   *    provider_credential 冻结在 job input，恢复查询不投影（详情走 GET /api/jobs/:id）。
   *  JSON path 过滤（input.target_node_id）经实测在 Prisma 7 + mariadb adapter 生效
   *  （path 须带 "$." 前缀，MySQL JSON 等值比较类型敏感）。 */
  async findCurrent(userId: string, projectId: string, query: Record<string, unknown>) {
    const parsed = videoFrameInterpolationRecoveryQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, "缺少目标节点 ID（target_node_id）");
    }
    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    const job = await this.prisma.client.generation_jobs.findFirst({
      where: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
        is_delete: false,
        input: {
          path: "$." + VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId,
          equals: parsed.data[VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId],
        },
      },
      orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
    });
    if (!job) return ok(null);
    return ok({
      job_id: job.id.toString(),
      status: job.status,
      progress: job.progress,
      created_at: job.gmt_create.toISOString(),
    });
  }
}
