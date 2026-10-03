// IKHW59：音频调速（画布音频卡「调速」，父单 IKHVYO）建任务服务。校验音频资产归属 →
// 插 generation_jobs(type=audio_speed)。一对一复刻 audio-trims.service（IKHB6N 先例）。
// 契约单源 = @lib/contracts/audio-speed（IKHW48）：input 键名 / speed 域与精度 / 贴原速省略
// 全部 import 契约常量，本文件不另写键名；冻结前经 audioSpeedInputSchema 服务端复核
// （speed ∈ [0.1,4.0]、最多两位小数——契约层精度收口，超精度在创建入口即拒）。
// 免费口径（同 audio_trim / media_extract）：不写成本预留、不接成本估算、不走余额拦截门。
// IKJJQW（B.3）：创建入口接入恢复协议 v1——canvas_binding 随 body 提交（剥离后不进业务校验），
// Idempotency-Key 头承载 submission_id；受理走共享受理段（media-tool-recovery）。
import { Injectable } from "@nestjs/common";
import {
  AUDIO_SPEED_INPUT_KEYS,
  AUDIO_SPEED_JOB_TYPE,
  AUDIO_SPEED_SOURCE,
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  audioSpeedInputSchema,
  fail,
  ok,
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
const IDEMPOTENCY_OPERATION = "audio_speed.create";
const REQUEST_PATH = "/audio-speeds";

@Injectable()
export class AudioSpeedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: {
      source_asset_id?: unknown;
      speed?: unknown;
      canvas_binding?: unknown;
    },
    // 与 audio_trim 同构（audio-trims.service.ts 的 internal 形参）：请求方 sk- 凭证
    // 冻结进 job input.provider_credential，worker 切网关后直接取用；未携带/非 sk- 时不写键。
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

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job 与原关联，不因此刻素材已删除/门槛不过而重新拒绝或重复受理。
    // 摘要只依赖请求载荷与 canvas_binding（mediaToolRequestHash），与可变状态无关。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: AUDIO_SPEED_JOB_TYPE,
          operation: IDEMPOTENCY_OPERATION,
          requestHash: mediaToolRequestHash(IDEMPOTENCY_OPERATION, projectId, REQUEST_PATH, body ?? {}),
          binding,
        }
      : null;
    const replay = recovery
      ? await readAcceptedMediaToolReplay(this.prisma.client, recovery)
      : null;
    if (replay) return renderMediaToolReplay(replay);

    // 归属口径对齐 audio_trim / media_extract（契约 §18.5）——findOwnedSource 按 user_id 归属过滤
    // （status=normal 且未删除），非本人素材一律 404 不泄露存在性。
    const asset = await this.assets.findOwnedSource(sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "audio") {
      return fail(FAILURE_CODE, "仅支持调速音频资产");
    }

    // 冻结结构复核（契约注释口径：创建入口复核用 audioSpeedInputSchema）：speed 可选键
    // （贴原速省略口径——缺省不补键，undefined = 走官方默认 1；显式传值必须为 [0.1, 4.0]
    // 内最多两位小数的 number，越界 / 超精度 / 非数字一律拒）。构造时用条件展开保证省略
    // 场景原样落库（键不写，同截取贴边省略口径）。
    const input = {
      [AUDIO_SPEED_INPUT_KEYS.sourceAssetId]: sourceAssetId,
      ...(rest.speed !== undefined ? { [AUDIO_SPEED_INPUT_KEYS.speed]: rest.speed } : {}),
    };
    const parsed = audioSpeedInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音频调速参数非法");
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
            type: AUDIO_SPEED_JOB_TYPE,
            source: AUDIO_SPEED_SOURCE,
            status: "queued",
            progress: 0,
            input: {
              ...parsed.data,
              // provider_credential 是业务键之上的基础设施键（不进契约 zod——audio_trim 同构）：
              // 请求方 sk- 明文冻结，worker 切网关后直接取用；未携带/非 sk- 时不写键。
              ...(internal.providerCredential
                ? { provider_credential: internal.providerCredential }
                : {}),
            },
            // 过去 60s：audio_speed 即时消费无延迟，next_action_at 必须 ≤ now 才能被 claim。
            // DATETIME(0) 秒精度会把 new Date() 进位到下一秒 → 同秒 claim 的 lte now 判 false，
            // 任务悬挂（audio_trim / media_extract 同款教训）。
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

  /** 入队失败兜底：queued 任务直接置 failed，避免调速任务无恢复扫描而静默悬挂。
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
