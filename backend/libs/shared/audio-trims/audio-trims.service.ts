// IKHB6N：音频截取（画布音频卡「截取」，父单 IKHB08）建任务服务。校验音频资产归属 →
// 插 generation_jobs(type=audio_trim)。同构 media-extractions.service（IKARDY/IKH28V 先例）。
// 契约单源 = @lib/contracts/audio-trim（IKHB6F）：格式枚举 / input 键名 / 贴边省略 / 提交精度
// 全部 import 契约常量，本文件不另写枚举与键名；冻结前经 audioTrimInputSchema 服务端复核
// （含 start_time < end_time、两位小数精度——官方 PDF 硬性条款）。
// 免费口径（同 media_extract / 去字幕）：不写成本预留、不接成本估算、不走余额拦截门。
// IKJJQW（B.3）：创建入口接入恢复协议 v1——canvas_binding 随 body 提交（剥离后不进业务校验），
// Idempotency-Key 头承载 submission_id；受理走共享受理段（media-tool-recovery）。
import { Injectable } from "@nestjs/common";
import {
  AUDIO_TRIM_INPUT_KEYS,
  AUDIO_TRIM_JOB_TYPE,
  AUDIO_TRIM_OUTPUT_FORMATS,
  AUDIO_TRIM_SOURCE,
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  audioTrimInputSchema,
  defaultAudioTrimOutputFormat,
  fail,
  ok,
  type AudioTrimOutputFormat,
} from "@lib/contracts";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import {
  createMediaToolJobWithRecovery,
  mediaToolRequestHash,
  takeCanvasBinding,
  type MediaToolRecovery,
} from "@lib/shared/generation/media-tool-recovery.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** IKJJQW：恢复协议受理的幂等域（先例命名「领域.动作」）。 */
const IDEMPOTENCY_OPERATION = "audio_trim.create";
const REQUEST_PATH = "/audio-trims";

const SUPPORTED_FORMATS: ReadonlySet<string> = new Set(AUDIO_TRIM_OUTPUT_FORMATS);

/** 契约枚举类型守卫（Set.has 不做类型窄化，收口在这单处）。 */
function isSupportedFormat(value: unknown): value is AudioTrimOutputFormat {
  return typeof value === "string" && SUPPORTED_FORMATS.has(value);
}

@Injectable()
export class AudioTrimsService {
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
      start_time?: unknown;
      end_time?: unknown;
      output_format?: unknown;
      canvas_binding?: unknown;
    },
    // 与 media_extract 同构（media-extractions.service.ts 的 internal 形参）：请求方 sk- 凭证
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
    // 契约口径（audio-trim.ts）：显式传入的 output_format 非法值明确拒绝（枚举五值
    // mp3/m4a/ogg/flac/wav，官方 PDF format 节列举顺序）；缺省值待查到源资产后按
    // 源文件名后缀推导（defaultAudioTrimOutputFormat，枚举外后缀回退 m4a）。
    let explicitOutputFormat: AudioTrimOutputFormat | undefined;
    if (rest.output_format !== undefined) {
      if (!isSupportedFormat(rest.output_format)) {
        return fail(PARAM_MISSING_CODE, "output_format 仅支持 mp3 / m4a / ogg / flac / wav");
      }
      explicitOutputFormat = rest.output_format;
    }

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    // 归属口径对齐 media_extract / 去字幕（契约 §18.5）——findOwnedSource 按 user_id 归属过滤
    // （status=normal 且未删除），非本人素材一律 404 不泄露存在性。
    const asset = await this.assets.findOwnedSource(sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "audio") {
      return fail(FAILURE_CODE, "仅支持截取音频资产");
    }

    // 缺省推导：默认跟随源音频格式（ADR-0111）——按 storage_key（含源文件名与后缀）推导；
    // storage_key 缺失（脏数据）/ 无后缀 / 枚举外后缀一律回退 m4a（官方默认值）。
    const outputFormat =
      explicitOutputFormat ?? defaultAudioTrimOutputFormat(asset.storage_key ?? "");

    // 冻结结构复核（契约注释口径：创建入口复核用 audioTrimInputSchema）：start_time / end_time
    // 可选键（贴边省略口径，undefined 键不落）；传值必须为非负、最多两位小数且 start < end
    // （官方 PDF 硬性条款）。构造时用条件展开保证省略场景原样落库（键不写）。
    const input = {
      [AUDIO_TRIM_INPUT_KEYS.sourceAssetId]: sourceAssetId,
      ...(rest.start_time !== undefined
        ? { [AUDIO_TRIM_INPUT_KEYS.startTime]: rest.start_time }
        : {}),
      ...(rest.end_time !== undefined ? { [AUDIO_TRIM_INPUT_KEYS.endTime]: rest.end_time } : {}),
      [AUDIO_TRIM_INPUT_KEYS.outputFormat]: outputFormat,
    };
    const parsed = audioTrimInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音频截取参数非法");
    }

    // IKJJQW：受理主体走共享段（B.3）——有 canvas_binding 时「恢复锁序核对 → 建行 → 关联行 →
    // 幂等行」一个事务；无 canvas_binding 时建行路径与接入前一致。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: AUDIO_TRIM_JOB_TYPE,
          operation: IDEMPOTENCY_OPERATION,
          requestHash: mediaToolRequestHash(IDEMPOTENCY_OPERATION, projectId, REQUEST_PATH, body ?? {}),
          binding,
        }
      : null;
    const outcome = await createMediaToolJobWithRecovery(
      this.prisma.client,
      recovery,
      async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: AUDIO_TRIM_JOB_TYPE,
            source: AUDIO_TRIM_SOURCE,
            status: "queued",
            progress: 0,
            input: {
              ...parsed.data,
              // provider_credential 是业务键之上的基础设施键（不进契约 zod——media_extract 同构）：
              // 请求方 sk- 明文冻结，worker 切网关后直接取用；未携带/非 sk- 时不写键。
              ...(internal.providerCredential
                ? { provider_credential: internal.providerCredential }
                : {}),
            },
            // 过去 60s：audio_trim 即时消费无延迟，next_action_at 必须 ≤ now 才能被 claim。
            // DATETIME(0) 秒精度会把 new Date() 进位到下一秒 → 同秒 claim 的 lte now 判 false，
            // 任务悬挂（media_extract 同款教训）。
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

  /** 入队失败兜底：queued 任务直接置 failed，避免截取任务无恢复扫描而静默悬挂。
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
