// IKHA2I：人声背景分离（vocal_split）建任务服务（仿 media-extractions 的免费轻量入口，
// 契约 @lib/contracts/vocal-split）。校验源资产归属 → 复核 scene / output_format 枚举
// （缺省补默认 audio / aac，非法值明确拒绝）→ 插 generation_jobs(type=vocal_split)。
// 免费口径（同去字幕 / media-extractions / video-enhancements）：不写成本预留、不接成本
// 估算、不走余额拦截门。不写画布——占位卡由前端建任务时本地插入（ADR-0108 骨架），
// job.input 冻结的三业务键即画布占位身份（前端 node.data 身份标记 lastInput 的数据源，
// 供刷新恢复与失败原样重试）。
import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  CANVAS_RECOVERY_PROTOCOL_VERSION,
  FAILURE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT,
  VOCAL_SPLIT_DEFAULT_SCENE,
  VOCAL_SPLIT_INPUT_KEYS,
  VOCAL_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_OUTPUT_FORMATS,
  VOCAL_SPLIT_SCENES,
  VOCAL_SPLIT_SOURCE,
  canvasBindingSchema,
  fail,
  ok,
  vocalSplitInputSchema,
  type CanvasBinding,
  type VocalSplitInput,
  type VocalSplitOutputFormat,
  type VocalSplitScene,
} from "@lib/contracts";
import {
  RecoveryContractError,
  canvasBindingView,
  createGenerationCommandRepo,
  lockCanvasRecoveryForAcceptance,
  writeCanvasRecoveryRows,
  type CanvasRecoveryAcceptance,
} from "@lib/shared/persistence/index.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

const SUPPORTED_SCENES: ReadonlySet<string> = new Set(VOCAL_SPLIT_SCENES);
const SUPPORTED_FORMATS: ReadonlySet<string> = new Set(VOCAL_SPLIT_OUTPUT_FORMATS);

/** IKJJQY：新协议受理的幂等表 operation 值（先例命名「领域.动作」，仅 canvas_binding
 *  请求启用——旧请求不接幂等，行为零变化）。 */
const IDEMPOTENCY_OPERATION = "vocal_split.create";

/** 契约枚举类型守卫（Set.has 不做类型窄化，收口在这单处）。 */
function isSupportedScene(value: unknown): value is VocalSplitScene {
  return typeof value === "string" && SUPPORTED_SCENES.has(value);
}

function isSupportedFormat(value: unknown): value is VocalSplitOutputFormat {
  return typeof value === "string" && SUPPORTED_FORMATS.has(value);
}

@Injectable()
export class VocalSplitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: { source_asset_id?: unknown; scene?: unknown; output_format?: unknown; canvas_binding?: unknown },
    // 与去字幕 / media-extractions 同构（internal 形参）：请求方 sk- 凭证冻结进
    // job input.provider_credential，worker 处理时直接取用；未携带/非 sk- 时不写键。
    internal: { providerCredential?: string } = {},
    // IKJJQY（B.3）：canvas_binding 的幂等承载（请求头 Idempotency-Key，无既有 client_token）。
    idempotencyKey?: string,
  ) {
    const sourceAssetId =
      typeof body.source_asset_id === "number" ||
      typeof body.source_asset_id === "string"
        ? String(body.source_asset_id)
        : "";
    if (!sourceAssetId) {
      return fail(PARAM_MISSING_CODE, "缺少 source_asset_id");
    }
    // 契约口径（@lib/contracts/vocal-split）：scene 缺省补默认 audio，传了非法值
    // （枚举外 / 非字符串 / null）明确拒绝，不静默回退。
    let scene: VocalSplitScene = VOCAL_SPLIT_DEFAULT_SCENE;
    if (body.scene !== undefined) {
      if (!isSupportedScene(body.scene)) {
        return fail(PARAM_MISSING_CODE, "scene 仅支持 audio / music / drama / narrate");
      }
      scene = body.scene;
    }
    // 同上：output_format 缺省补默认 aac（注意与 extract-audio 默认 m4a 不同），非法值明确拒绝。
    let outputFormat: VocalSplitOutputFormat = VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT;
    if (body.output_format !== undefined) {
      if (!isSupportedFormat(body.output_format)) {
        return fail(PARAM_MISSING_CODE, "output_format 仅支持 aac / mp3 / wav / m4a / flac");
      }
      outputFormat = body.output_format;
    }

    // IKJJQY（B.3）：canvas_binding 纯载荷校验——Idempotency-Key 必须等于 submission_id
    // （人声分离原本无幂等；新协议受理才接 command_idempotency + 恢复关联，旧请求零变化）。
    let canvasBinding: CanvasBinding | null = null;
    if (body.canvas_binding !== undefined && body.canvas_binding !== null) {
      const parsedBinding = canvasBindingSchema.safeParse(body.canvas_binding);
      if (!parsedBinding.success) {
        return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
      }
      canvasBinding = parsedBinding.data;
      if ((idempotencyKey ?? "").trim() !== canvasBinding.submission_id) {
        return fail(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", {
          reason: RECOVERY_REASONS.invalidPayload,
        });
      }
    }

    // 冻结后三键恒在，契约 schema 复核（scene / output_format 已被守卫拦住，此处兜住
    // source_asset_id 非数字形态的请求，zod 正则单源在契约）。
    const parsed = vocalSplitInputSchema.safeParse({
      [VOCAL_SPLIT_INPUT_KEYS.sourceAssetId]: sourceAssetId,
      [VOCAL_SPLIT_INPUT_KEYS.scene]: scene,
      [VOCAL_SPLIT_INPUT_KEYS.outputFormat]: outputFormat,
    });
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, "source_asset_id 必须为正整数 ID");
    }
    const input: VocalSplitInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    // 归属口径对齐去字幕 / media-extractions 先例：findOwnedSource 按 user_id 归属过滤
    // （status=normal 且未删除），非本人素材一律 404 不泄露存在性。
    const asset = await this.assets.findOwnedSource(sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    // 契约 §VOCAL_SPLIT_INPUT_KEYS.sourceAssetId：被分离音轨的视频/音频 Asset（官方
    // video_url / audio_url 二选一），两种源类型均放行。
    if (asset.type !== "video" && asset.type !== "audio") {
      return fail(FAILURE_CODE, "仅支持从视频或音频资产发起人声背景分离");
    }

    // IKJJQY：携带 canvas_binding 时走恢复受理事务（锁序同 B.3：项目→画布→锁内幂等回读→
    // owner 版本核对，冲突在任务写入前零副作用拒绝）；job + 幂等行 + submission/owner 关联行
    // 同事务。无绑定时保持原直建路径（无幂等行为零变化）。
    if (canvasBinding) {
      const requestHash = createHash("sha256")
        .update(
          `POST:/api/projects/${projectId}/vocal-splits` +
            `\0${input[VOCAL_SPLIT_INPUT_KEYS.sourceAssetId]}` +
            `\0${input[VOCAL_SPLIT_INPUT_KEYS.scene]}` +
            `\0${input[VOCAL_SPLIT_INPUT_KEYS.outputFormat]}` +
            `\0${JSON.stringify(canvasBinding)}`,
        )
        .digest("hex");
      const acceptance: CanvasRecoveryAcceptance = {
        projectId,
        userId,
        binding: canvasBinding,
        operation: IDEMPOTENCY_OPERATION,
        requestHash,
        idempotencyKey: canvasBinding.submission_id,
        taskType: VOCAL_SPLIT_JOB_TYPE,
      };
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const locked = await lockCanvasRecoveryForAcceptance(tx, acceptance);
          if (locked.kind === "replay") {
            const replayed = await tx.generation_jobs.findUnique({
              where: { id: BigInt(locked.result.generation_job_id) },
              select: { status: true },
            });
            // 同意图网络重放返回原关联（不重复建任务、不重复入队），job 状态现读。
            return ok({
              job_id: locked.result.generation_job_id,
              status: replayed?.status ?? "queued",
              canvas_binding: await canvasBindingView(
                this.prisma.client, projectId, canvasBinding.submission_id,
              ),
            });
          }
          if (locked.kind === "idempotency_conflict") {
            return fail(IDEMPOTENCY_KEY_REUSED_CODE, "Idempotency-Key 已被使用（同键仅可重放相同参数）");
          }
          const job = await tx.generation_jobs.create({
            data: {
              user_id: BigInt(userId),
              project_id: BigInt(projectId),
              type: VOCAL_SPLIT_JOB_TYPE,
              source: VOCAL_SPLIT_SOURCE,
              status: "queued",
              progress: 0,
              input: {
                ...input,
                ...(internal.providerCredential
                  ? { provider_credential: internal.providerCredential }
                  : {}),
              },
              next_action_at: new Date(Date.now() - 60_000),
            },
          });
          await tx.command_idempotency.create({
            data: {
              project_id: BigInt(projectId),
              operation: IDEMPOTENCY_OPERATION,
              idempotency_key: canvasBinding.submission_id,
              request_hash: requestHash,
              generation_job_id: job.id,
              accepted_cursor: 0n,
            },
          });
          await writeCanvasRecoveryRows(tx, locked.plan, job.id);
          return ok({
            job_id: job.id.toString(),
            status: "queued",
            // 受理视图（B.3 成功 data 新增字段）：刚受理必然拥有目标承接；事务内构造。
            canvas_binding: {
              protocol_version: CANVAS_RECOVERY_PROTOCOL_VERSION,
              submission_id: canvasBinding.submission_id,
              target_node_id: canvasBinding.target_node_id,
              binding_revision: locked.plan.bindingRevision,
              job_id: job.id.toString(),
              is_current: true,
            },
          });
        });
      } catch (error) {
        // B.8：新协议受控错误信封直写（code=HTTP 状态），事务已随异常回滚。
        if (error instanceof RecoveryContractError) return error.envelope;
        throw error;
      }
    }

    const job = await this.prisma.client.generation_jobs.create({
      data: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: VOCAL_SPLIT_JOB_TYPE,
        source: VOCAL_SPLIT_SOURCE,
        status: "queued",
        progress: 0,
        // scene 决定轨数（audio/music→2、drama/narrate→3），契约 VOCAL_SPLIT_SCENE_TRACKS 单源。
        // IKJCOE：轨数不再落主表 expected_output_count（列已删）——Worker 按 scene 自推轨序，
        // 该值此前无任何读方（仅记录）。
        // 冻结三业务键 = 画布占位身份（前端 lastInput 数据源，重试原样沿用）；
        // provider_credential 是业务键之上的基础设施键（不进契约 zod——去字幕同构）。
        input: {
          ...input,
          ...(internal.providerCredential
            ? { provider_credential: internal.providerCredential }
            : {}),
        },
        // 过去 60s：回拨口径同 media_extract / 去字幕——DATETIME(0) 秒精度进位会让同秒
        // claim 的 lte now 判 false，任务悬挂。
        next_action_at: new Date(Date.now() - 60_000),
      },
    });
    return ok({
      job_id: job.id.toString(),
      status: "queued",
    });
  }

  /** 入队失败兜底：queued 任务直接置 failed，避免人声分离任务在 worker 领取前静默悬挂。
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
