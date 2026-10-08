// IKHK98：智能抠像（video_matting，火山 MediaKit matte-portrait-video /
// matte-greenscreen-video 双端点）建任务服务，仿 video-scene-splits / video-enhancements
// 的免费轻量入口，契约 @lib/contracts/video-matting。校验源视频资产归属 → 复核输入门槛
// （时长 ≤10 分钟，duration_ms null 放行）→ 插 generation_jobs(type=video_matting)。
// 免费口径（同去字幕 / HD / 场景切分）：不写成本预留、不接成本估算、不走余额拦截门。
// 幂等（验收口径）：body 携带 client_token（≤64 可打印 ASCII、大小写敏感，pattern 单源
// = 契约 VIDEO_MATTING_CLIENT_TOKEN_PATTERN），接入 command_idempotency（先例
// storyboard-preview / generation.retry / video_scene_split.create）：同 token 同参数摘要
// 重放首次 job_id、同 token 异参数摘要判冲突（100302）；幂等行与任务行**同一事务**原子
// 落库（无半创建状态），唯一键竞态由 transactionWithUniqueRetry 兜底。
// 「任务与画布占位数据同事务创建」的落法：画布单写入方架构（IKFS5W：后端停写 nodes_json，
// 前端 PUT /api/canvases/:projectId 唯一写入方）——后端不直接写画布，占位卡绑定数据
// （input.target_node_id，契约 INPUT_KEYS）随任务行同事务原子落库；前端发送前本地建任务
// 占位卡、按本键把 job 映射到卡（轮询终态 / 完成回填 / 失败重试），占位卡随画布保存。
// IKJJQW（B.3）：创建入口接入恢复协议 v1——本入口的幂等承载是 body 的 client_token
// （不是 Idempotency-Key 头），canvas_binding 携带时 client_token 必须等于 submission_id；
// 摘要改用覆盖完整 canvas_binding 的规范化口径（mediaToolRequestHash），幂等域不变。
// 资产复核随受理锁序要求（B.3「锁不跨前置素材查询」）挪到事务外，重放仍先于素材状态。
import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_MATTING_CLIENT_TOKEN_PATTERN,
  VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR,
  VIDEO_MATTING_DEFAULT_FORMAT,
  VIDEO_MATTING_INPUT_KEYS,
  VIDEO_MATTING_JOB_TYPE,
  VIDEO_MATTING_MAX_DURATION_MS,
  VIDEO_MATTING_SOURCE,
  fail,
  ok,
  videoMattingInputSchema,
  type VideoMattingInput,
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

/** 幂等表 operation 值（先例命名「领域.动作」：video_scene_split.create / generation.retry 同款）。 */
const IDEMPOTENCY_OPERATION = "video_matting.create";
const REQUEST_PATH = "/video-mattings";

/** zod 校验失败 → 人能读懂的原因（按首个出错键名映射；前端置灰只是体验层，这里返回可读文案）。 */
const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [VIDEO_MATTING_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [VIDEO_MATTING_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [VIDEO_MATTING_INPUT_KEYS.mode]: "抠像模式仅支持 portrait（人像）/ greenscreen（绿幕）",
  [VIDEO_MATTING_INPUT_KEYS.format]: "输出格式仅支持 WEBM / MP4",
  [VIDEO_MATTING_INPUT_KEYS.backgroundColor]: "背景色仅支持 white / black / green",
};

function readableParseError(
  issues: readonly { code: string; message?: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[],
): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许智能抠像任务的 source_asset_id / target_node_id / mode / format / background_color / client_token 键";
  }
  // superRefine 的条件键约束（MP4 必填背景色 / WEBM 拒收背景色）直接透传 issue.message
  // ——契约 schema 里的定案文案，比按键名映射更准确。
  if (first?.code === "custom" && first.message) {
    return first.message;
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

/** 同 token 重放冲突判定用的请求摘要（sha256）：显式定序拼接业务键，规避 JSON 键序漂移
 *  （先例 video_scene_split.create 的 method:path:content 口径）。background_color 仅
 *  MP4 时存在（schema refine 保证 WEBM 恒无键），缺失位以空串占位保持摘要确定性。 */
function requestHashOf(projectId: string, input: VideoMattingInput): string {
  return createHash("sha256")
    .update(
      `POST:/api/projects/${projectId}/video-mattings` +
        `:${input[VIDEO_MATTING_INPUT_KEYS.sourceAssetId]}` +
        `\0${input[VIDEO_MATTING_INPUT_KEYS.targetNodeId]}` +
        `\0${input[VIDEO_MATTING_INPUT_KEYS.mode]}` +
        `\0${input[VIDEO_MATTING_INPUT_KEYS.format]}` +
        `\0${input[VIDEO_MATTING_INPUT_KEYS.backgroundColor] ?? ""}`,
    )
    .digest("hex");
}

@Injectable()
export class VideoMattingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
  ) {
    // client_token 是业务键之上的基础设施键（不进契约 zod——它校验业务 payload；token 的
    // 消费方是 command_idempotency 表，不冻结进 job input）：先行剥离再过契约 schema。
    const { client_token: clientToken, ...withoutToken } = body ?? {};
    if (
      typeof clientToken !== "string" ||
      !VIDEO_MATTING_CLIENT_TOKEN_PATTERN.test(clientToken)
    ) {
      return fail(PARAM_MISSING_CODE, "缺少或非法的 client_token（幂等键，≤64 位可打印 ASCII、大小写敏感）");
    }
    // IKJJQW（B.3）：canvas_binding 剥离；本入口的幂等承载是 client_token，携带 canvas_binding
    // 时必须等于 submission_id（B.3「工具原 client_token 承载」口径）。IKJLTZ：收敛至
    // stripCanvasBinding，client_token 严格原值比较——pattern 允许空白，不随头形态 trim。
    const gate = stripCanvasBinding(withoutToken, "client_token", clientToken);
    if (gate.error) return gate.error;
    const { binding, rest } = gate;

    // 契约口径（vocal_split 缺省补默认同款）：format 缺省补 WEBM、background_color 仅
    // format=MP4 时缺省补 white 后再过 schema（冻结后形态）；非法值（null / 枚举外 / 非
    // 字符串）不在此拦也不静默回退——原样交 schema 明确拒绝。format 非法时 background_color
    // 保持原样（MP4 分支不命中），错误文案落在 format 键上。
    const normalizedBody: Record<string, unknown> = { ...rest };
    if (normalizedBody[VIDEO_MATTING_INPUT_KEYS.format] === undefined) {
      normalizedBody[VIDEO_MATTING_INPUT_KEYS.format] = VIDEO_MATTING_DEFAULT_FORMAT;
    }
    if (
      normalizedBody[VIDEO_MATTING_INPUT_KEYS.format] === "MP4" &&
      normalizedBody[VIDEO_MATTING_INPUT_KEYS.backgroundColor] === undefined
    ) {
      normalizedBody[VIDEO_MATTING_INPUT_KEYS.backgroundColor] =
        VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR;
    }
    // 契约 schema 复核（strict 五键）：mode / format / background_color 枚举在此拦截
    // （MOV 档不暴露、非法值明确拒绝不给隐式降档）；MP4 必填背景色、WEBM 拒收背景色由
    // superRefine 收口。mode 无默认（双模式必选一，入口下拉直选，ADR-0112）。
    const parsed = videoMattingInputSchema.safeParse(normalizedBody);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoMattingInput = parsed.data;
    // IKJJQW：canvas_binding 请求摘要覆盖业务参数与完整 binding（B.3）；无 binding 老路径
    // 沿用显式拼接口径（同 token 老请求的重放摘要不变）。
    const requestHash = binding
      ? mediaToolRequestHash(IDEMPOTENCY_OPERATION, projectId, REQUEST_PATH, body ?? {})
      : requestHashOf(projectId, input);

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job（binding 形态另回原关联），不因此刻素材已删除/门槛不过而
    // 重新拒绝或重复受理。摘要只依赖请求载荷与 canvas_binding，与可变状态无关；legacy
    // client_token 形态的冲突沿用本入口既有码与文案（IDEMPOTENCY_KEY_REUSED_CODE）。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: VIDEO_MATTING_JOB_TYPE,
          operation: IDEMPOTENCY_OPERATION,
          requestHash,
          binding,
        }
      : null;
    const replay = recovery
      ? await readAcceptedMediaToolReplay(this.prisma.client, recovery)
      : await readAcceptedMediaToolReplay(this.prisma.client, {
          projectId,
          operation: IDEMPOTENCY_OPERATION,
          requestHash,
          key: clientToken,
        });
    if (replay) {
      // 冲突口径与结尾渲染同款区分：binding 形态走 IDEMPOTENCY_CONFLICT_CODE，
      // legacy client_token 形态沿用本入口既有码与文案（IDEMPOTENCY_KEY_REUSED_CODE）。
      return renderMediaToolReplay(
        replay,
        binding
          ? undefined
          : () => fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）"),
      );
    }

    // IKJJQW：资产复核与输入门槛在事务外（B.3「锁不跨前置素材查询」——canvas_binding 受理的
    // 恢复锁序对项目/画布行 FOR UPDATE，素材复核必须在进锁前完成）。IKJLTX 后重放的回读先于
    // 本段（素材状态不再改写已受理意图的结果），锁外快路径与锁内兜底在 helper 内。
    // findOwnedSource 按 user_id 归属过滤（status=normal 且未删除）：非本人素材一律 404，
    // 不泄露存在性。
    const asset = await this.assets.findOwnedSource(
      input[VIDEO_MATTING_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持对视频资产发起智能抠像");
    }

    // 输入门槛复核（10 分钟产品上限，ADR-0112——官方处理耗时为时长 1~3 倍而 worker 轮询
    // 上限约 60 分钟，不拦等于注定超时失败；常量单源在契约 video-matting.ts，web 按钮
    // 门槛预检同源）。assets.duration_ms 由前端上报、存量大量为 null：缺权威值不臆造、
    // 不拦——放行交供应商按官方门槛拒（与去字幕 / HD / 场景切分同口径）。
    if (asset.duration_ms != null && asset.duration_ms > VIDEO_MATTING_MAX_DURATION_MS) {
      return fail(FAILURE_CODE, "暂支持 10 分钟以内的视频智能抠像");
    }

    const frozenInput: VideoMattingInput = { ...input };

    // IKJJQW：受理主体走共享段——有 canvas_binding 时「恢复锁序核对 → 建行 → 关联行 → 幂等行」
    // 一个事务；无 canvas_binding 时保持既有 client_token 幂等事务（回读 → 建行 → 幂等行）。
    // IKJLTX 后前置回读已在上游，此处事务内仍有锁内回读兜底。
    const outcome = await createMediaToolJobWithRecovery(
      this.prisma.client,
      recovery,
      async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: VIDEO_MATTING_JOB_TYPE,
            source: VIDEO_MATTING_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            // 过去 60s：回拨口径同去字幕 / HD / 场景切分——DATETIME(0) 秒精度进位会让
            // 同秒 claim 的 lte now 判 false，任务悬挂。
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      binding
        ? undefined
        : { projectId, operation: IDEMPOTENCY_OPERATION, requestHash, key: clientToken },
    );
    if (outcome.kind === "envelope") return outcome.envelope;
    if (outcome.kind === "idempotency_conflict") {
      // 创建意图异载荷：canvas_binding 请求走 B.8 指定的 IDEMPOTENCY_CONFLICT_CODE，
      // 老 client_token 请求沿用本入口既有码与文案。
      if (binding) return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
      return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
    }
    return ok({
      job_id: outcome.jobId,
      status: outcome.status,
      ...(outcome.bindingView ? { canvas_binding: outcome.bindingView } : {}),
    });
  }

  /** 入队失败兜底：queued 任务直接置 failed，避免智能抠像任务在 worker 领取前静默悬挂。
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
