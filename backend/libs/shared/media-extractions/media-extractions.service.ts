// IKARDY：媒体提取（视频→音频）建任务服务。校验视频资产归属 → 插 generation_jobs(type=media_extract)。
// IKFS5W：不写画布——占位节点由前端建任务前本地插入，产物经 GET /api/jobs/:id 的 asset 回给前端落库。
// IKH28T：output_format 枚举/默认值/拒绝口径单源到契约 @lib/contracts/media-extract（m4a 默认、
// 非法值明确拒绝，静默回退口径随契约废除）。
// IKH28V：切火山网关前的创建入口行为补齐（契约 §18.5）——资产归属读法对齐去字幕
// （findOwnedSource）、请求方 sk- 凭证冻结进 input.provider_credential（worker IKH28W 取用）。
// 免费口径（同去字幕 / image-erasures）：不写成本预留、不接成本估算、不走余额拦截门。
// IKJJQW（B.3）：创建入口接入恢复协议 v1——canvas_binding 随 body 提交（剥离后不进业务校验），
// Idempotency-Key 头承载 submission_id；受理走共享受理段（media-tool-recovery）。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT,
  MEDIA_EXTRACT_INPUT_KEYS,
  MEDIA_EXTRACT_JOB_TYPE,
  MEDIA_EXTRACT_OUTPUT_FORMATS,
  MEDIA_EXTRACT_SOURCE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
  type MediaExtractOutputFormat,
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
const IDEMPOTENCY_OPERATION = "media_extract.create";
const REQUEST_PATH = "/media-extractions";

const SUPPORTED_FORMATS: ReadonlySet<string> = new Set(MEDIA_EXTRACT_OUTPUT_FORMATS);

/** 契约枚举类型守卫（Set.has 不做类型窄化，收口在这单处）。 */
function isSupportedFormat(value: unknown): value is MediaExtractOutputFormat {
  return typeof value === "string" && SUPPORTED_FORMATS.has(value);
}

@Injectable()
export class MediaExtractionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: { source_asset_id?: unknown; output_format?: unknown; canvas_binding?: unknown },
    // 与去字幕同构（video-subtitle-erasures.service.ts 的 internal 形参）：请求方 sk- 凭证
    // 冻结进 job input.provider_credential，worker 切网关后（IKH28W）直接取用；未携带/非 sk- 时不写键。
    internal: { providerCredential?: string } = {},
    // IKJJQW（B.3）：新协议承载——Idempotency-Key 头必须等于 canvas_binding.submission_id。
    idempotencyKey?: string,
  ) {
    // IKJJQW：canvas_binding 剥离与承载一致性校验（B.8 invalid_recovery_payload）。
    const { binding, rest, invalid } = takeCanvasBinding(body ?? ({} as Record<string, unknown>));
    if (invalid) {
      return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
    }
    if (binding && (idempotencyKey ?? "").trim() !== binding.submission_id) {
      return fail(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", {
        reason: RECOVERY_REASONS.invalidPayload,
      });
    }
    const sourceAssetId =
      typeof rest.source_asset_id === "number" ||
      typeof rest.source_asset_id === "string"
        ? String(rest.source_asset_id)
        : "";
    if (!sourceAssetId) {
      return fail(PARAM_MISSING_CODE, "缺少 source_asset_id");
    }
    // IKH28T 契约口径：缺省补默认 m4a（官方 PDF format 节描述文字），非法值明确拒绝
    // （不再静默回退 mp3——枚举五值 m4a/mp3/ogg/flac/wav 单源在 @lib/contracts/media-extract）。
    let outputFormat: MediaExtractOutputFormat = MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT;
    if (rest.output_format !== undefined) {
      if (!isSupportedFormat(rest.output_format)) {
        return fail(PARAM_MISSING_CODE, "output_format 仅支持 m4a / mp3 / ogg / flac / wav");
      }
      outputFormat = rest.output_format;
    }

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job 与原关联，不因此刻素材已删除/门槛不过而重新拒绝或重复受理。
    // 摘要只依赖请求载荷与 canvas_binding（mediaToolRequestHash），与可变状态无关。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: MEDIA_EXTRACT_JOB_TYPE,
          operation: IDEMPOTENCY_OPERATION,
          requestHash: mediaToolRequestHash(IDEMPOTENCY_OPERATION, projectId, REQUEST_PATH, body ?? {}),
          binding,
        }
      : null;
    const replay = recovery
      ? await readAcceptedMediaToolReplay(this.prisma.client, recovery)
      : null;
    if (replay) return renderMediaToolReplay(replay);

    // IKH28V：归属口径对齐去字幕先例（契约 §18.5）——findOwnedSource 按 user_id 归属过滤
    // （status=normal 且未删除），非本人素材一律 404 不泄露存在性。与原 findAccessible 的
    // where 条件逐字相同（id+user_id+normal+未删），切换无用户可见行为变化，仅换去字幕
    // 同款源资产读法（富投影，切网关后口径单源）。
    const asset = await this.assets.findOwnedSource(sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持从视频资产提取音频");
    }

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
            type: MEDIA_EXTRACT_JOB_TYPE,
            source: MEDIA_EXTRACT_SOURCE,
            status: "queued",
            progress: 0,
            input: {
              [MEDIA_EXTRACT_INPUT_KEYS.sourceAssetId]: sourceAssetId,
              [MEDIA_EXTRACT_INPUT_KEYS.outputFormat]: outputFormat,
              // provider_credential 是业务键之上的基础设施键（不进契约 zod——去字幕同构）：
              // 请求方 sk- 明文冻结，worker 切网关后（IKH28W）直接取用；未携带/非 sk- 时不写键。
              ...(internal.providerCredential
                ? { provider_credential: internal.providerCredential }
                : {}),
            },
            // 过去 60s：media_extract 即时消费无延迟，next_action_at 必须 ≤ now 才能被 claim。
            // DATETIME(0) 秒精度会把 new Date() 进位到下一秒 → 同秒 claim 的 lte now 判 false，任务悬挂（media_extract 无恢复扫描）。
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

  /** 入队失败兜底：queued 任务直接置 failed，避免媒体提取任务无恢复扫描而静默悬挂。
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
