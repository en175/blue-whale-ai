// IKGZ80：视频智能去字幕建任务服务（仿 image-erasures 的免费轻量入口，迁移契约 §17，
// 契约 @lib/contracts/video-subtitle-erase）。校验源视频资产归属 → 复核输入门槛
// （分辨率 2K / 时长 10 分钟，宽高/时长 null 放行）→ 插 generation_jobs(type=video_subtitle_erase)。
// 免费口径（同 image-erasures / image-enhancements）：不写成本预留、不接成本估算、不走余额拦截门。
// 不写画布——去字幕结果卡由前端发送任务时本地插入，产物经 GET /api/jobs/:id 的 asset 按 target_node_id 回填。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_SUBTITLE_ERASE_INPUT_KEYS,
  VIDEO_SUBTITLE_ERASE_JOB_TYPE,
  VIDEO_SUBTITLE_ERASE_MAX_BOXES,
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_SOURCE,
  fail,
  ok,
  videoSubtitleEraseInputSchema,
  type VideoSubtitleEraseInput,
} from "@lib/contracts";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import {
  createMediaToolJobWithRecovery,
  replayAcceptedMediaTool,
  stripCanvasBinding,
} from "@lib/shared/generation/media-tool-recovery.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** IKJJQW：恢复协议受理的幂等域（先例命名「领域.动作」）。 */
const IDEMPOTENCY_OPERATION = "video_subtitle_erase.create";
const REQUEST_PATH = "/video-subtitle-erasures";

/** zod 校验失败 → 人能读懂的原因（按首个出错键名映射；前端置灰只是体验层，这里返回可读文案）。 */
const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.detectMode]: "检测模式仅支持 subtitle_smart / text_full",
  [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.eraseBoxes]: `擦除框列表不合法（最多 ${VIDEO_SUBTITLE_ERASE_MAX_BOXES} 个框，每框 top_left_x / top_left_y / bottom_right_x / bottom_right_y 取值 0~1）`,
};

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许去字幕任务的 source_asset_id / target_node_id / detect_mode / erase_boxes 键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

@Injectable()
export class VideoSubtitleErasuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
    // IKJJQW（B.3）：新协议承载——Idempotency-Key 头必须等于 canvas_binding.submission_id。
    idempotencyKey?: string,
  ) {
    // IKJJQW：canvas_binding 是业务键之上的基础设施键（同 client_token 口径）：先行剥离再过
    // 契约 schema；携带但非法 / 与 Idempotency-Key 承载不一致 → 400 invalid_recovery_payload
    // （IKJLTZ：三段校验收敛至 stripCanvasBinding，头承载的 trim 口径留在调用方）。
    const gate = stripCanvasBinding(body ?? {}, "Idempotency-Key", (idempotencyKey ?? "").trim());
    if (gate.error) return gate.error;
    const { binding, rest } = gate;

    // 契约 schema 复核（strict 四键）：检测模式枚举、框列表 ≤20 与 [0,1] 坐标在此拦截。
    const parsed = videoSubtitleEraseInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoSubtitleEraseInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job 与原关联，不因此刻素材已删除/门槛不过而重新拒绝或重复受理。
    // 摘要只依赖请求载荷与 canvas_binding，与可变状态无关（门本体见 replayAcceptedMediaTool）。
    const { recovery, replayed } = await replayAcceptedMediaTool(this.prisma.client, {
      projectId,
      userId,
      binding,
      taskType: VIDEO_SUBTITLE_ERASE_JOB_TYPE,
      operation: IDEMPOTENCY_OPERATION,
      requestPath: REQUEST_PATH,
      body: body ?? {},
    });
    if (replayed) return replayed;

    // findOwnedSource 按 user_id 归属过滤（status=normal 且未删除）：非本人素材一律 404，不泄露存在性。
    const asset = await this.assets.findOwnedSource(
      input[VIDEO_SUBTITLE_ERASE_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持对视频资产发起去字幕");
    }

    // 输入门槛复核（官方 PDF 输入分辨率限制「最高支持 2K」+ 产品 10 分钟上限，短边/长边语义：
    // 短边 ≤1440、长边 ≤2560，竖屏 1440x2560 合法；常量单源在契约 video-subtitle-erase.ts，
    // web 按钮门槛预检同源）。assets.width/height/duration_ms 由前端上报、存量大量为 null：
    // 缺权威值不臆造、不拦——放行交供应商按官方门槛拒（与擦除/高清同口径）。
    if (asset.width != null && asset.height != null) {
      const longSide = Math.max(asset.width, asset.height);
      const shortSide = Math.min(asset.width, asset.height);
      if (
        longSide > VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX ||
        shortSide > VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX
      ) {
        return fail(
          FAILURE_CODE,
          `视频长边超过 ${VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX} 或短边超过 ${VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX} 像素上限（2K），无法去字幕`,
        );
      }
    }
    if (asset.duration_ms != null && asset.duration_ms > VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS) {
      return fail(FAILURE_CODE, "暂支持 10 分钟以内的视频去字幕");
    }

    // 契约 schema parse 后原样冻结（重试原样沿用，§17.2）。
    const frozenInput: VideoSubtitleEraseInput = { ...input };

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
            type: VIDEO_SUBTITLE_ERASE_JOB_TYPE,
            source: VIDEO_SUBTITLE_ERASE_SOURCE,
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

  /** 入队失败兜底：queued 任务直接置 failed，避免去字幕任务在 worker 恢复扫描接管前静默悬挂。
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
