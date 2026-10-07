// IKH8BO：视频场景切分（火山 MediaKit segment-scenes）建任务服务，仿 video-enhancements /
// video-subtitle-erasures 的免费轻量入口，契约 @lib/contracts/video-scene-split。校验源视频
// 资产归属 → 复核输入门槛（时长 ≤2 小时，duration_ms null 放行）→ 插
// generation_jobs(type=video_scene_split)。免费口径（同去字幕 / HD / 音视频分离）：不写成本
// 预留、不接成本估算、不走余额拦截门。
// 幂等（IKH8BO 验收）：body 携带 client_token（≤64 可打印 ASCII、大小写敏感，口径对齐火山
// 官方 API 的 client_token 参数约束），接入 command_idempotency（先例 storyboard-preview /
// generation.retry / scene_card.regenerate）：同 token 同参数摘要重放首次 job_id、同 token
// 异参数摘要判冲突（100302）；幂等行与任务行**同一事务**原子落库（无半创建状态），唯一键
// 竞态由 transactionWithUniqueRetry 兜底。
// 「任务与画布占位数据同事务创建」的落法：画布单写入方架构（IKFS5W：后端停写 nodes_json，
// 前端 PUT /api/canvases/:projectId 唯一写入方）——后端不直接写画布，占位卡绑定数据
// （input.target_node_id，IKH8BO 契约扩展）随任务行同事务原子落库；前端发送前本地建任务
// 占位卡、按本键把 job 映射到卡（轮询终态 / 完成扇出 / 失败重试），占位卡随画布保存。
import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  CANVAS_RECOVERY_PROTOCOL_VERSION,
  FAILURE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_SCENE_SPLIT_INPUT_KEYS,
  VIDEO_SCENE_SPLIT_JOB_TYPE,
  VIDEO_SCENE_SPLIT_MAX_DURATION_MS,
  VIDEO_SCENE_SPLIT_SOURCE,
  canvasBindingSchema,
  fail,
  ok,
  videoSceneSplitInputSchema,
  type CanvasBinding,
  type VideoSceneSplitInput,
} from "@lib/contracts";
import {
  RecoveryContractError,
  canvasBindingView,
  createGenerationCommandRepo,
  lockCanvasRecoveryForAcceptance,
  writeCanvasRecoveryRows,
  type CanvasRecoveryAcceptance,
  type CanvasRecoveryPlan,
} from "@lib/shared/persistence/index.js";
import { transactionWithUniqueRetry } from "@lib/shared/persistence/conversation-repo.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** 幂等表 operation 值（先例命名「领域.动作」：scene_card.regenerate / generation.retry 同款）。 */
const IDEMPOTENCY_OPERATION = "video_scene_split.create";

/** client_token 约束（官方 PDF 口径：≤64 可打印 ASCII、大小写敏感——本仓不做任何归一化，
 *  逐字节存储比对；可打印 ASCII = 0x20~0x7E，至少 1 位）。 */
const CLIENT_TOKEN_PATTERN = /^[\x20-\x7E]{1,64}$/;

/** zod 校验失败 → 人能读懂的原因（按首个出错键名映射；前端置灰只是体验层，这里返回可读文案）。 */
const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [VIDEO_SCENE_SPLIT_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [VIDEO_SCENE_SPLIT_INPUT_KEYS.granularity]: "切分粒度仅支持 fine / standard / coarse",
};

function readableParseError(
  issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[],
): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许场景切分任务的 source_asset_id / target_node_id / granularity / client_token 键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

/** 同 token 重放冲突判定用的请求摘要（sha256）：显式定序拼接三业务键，规避 JSON 键序漂移
 *  （先例 scene-cards.controller 的 method:path:content 口径）。
 *  IKJJQY（B.3）：携带 canvas_binding 时摘要覆盖完整绑定（请求摘要覆盖原业务参数与
 *  完整 canvas_binding，不含认证 token）。 */
function requestHashOf(projectId: string, input: VideoSceneSplitInput, canvasBinding?: CanvasBinding | null): string {
  return createHash("sha256")
    .update(
      `POST:/api/projects/${projectId}/video-scene-splits` +
        `:${input[VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId]}` +
        `\0${input[VIDEO_SCENE_SPLIT_INPUT_KEYS.targetNodeId]}` +
        `\0${input[VIDEO_SCENE_SPLIT_INPUT_KEYS.granularity]}` +
        (canvasBinding ? `\0${JSON.stringify(canvasBinding)}` : ""),
    )
    .digest("hex");
}

@Injectable()
export class VideoSceneSplitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
    // 与去字幕 / HD / 音视频分离同构（video-subtitle-erasures.service.ts 的 internal 形参）：
    // 请求方 sk- 凭证冻结进 job input.provider_credential，worker 处理时直接取用。
    internal: { providerCredential?: string } = {},
  ) {
    // client_token 是业务键之上的基础设施键（不进契约 zod——它校验业务 payload；token 的
    // 消费方是 command_idempotency 表，不冻结进 job input）：先行剥离再过契约 schema。
    // IKJJQY：canvas_binding 同为业务键之上的协议字段，一并剥离（strict schema 不认）。
    const { client_token: clientToken, canvas_binding: canvasBindingBody, ...businessBody } = body ?? {};
    if (typeof clientToken !== "string" || !CLIENT_TOKEN_PATTERN.test(clientToken)) {
      return fail(PARAM_MISSING_CODE, "缺少或非法的 client_token（幂等键，≤64 位可打印 ASCII、大小写敏感）");
    }

    // IKJJQY（B.3）：canvas_binding 纯载荷校验——client_token 必须等于 submission_id
    // （「工具原 client_token 必须等于 submission_id」由本入口现有承载方式承担）。
    let canvasBinding: CanvasBinding | null = null;
    if (canvasBindingBody !== undefined && canvasBindingBody !== null) {
      const parsedBinding = canvasBindingSchema.safeParse(canvasBindingBody);
      if (!parsedBinding.success) {
        return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
      }
      canvasBinding = parsedBinding.data;
      if (clientToken !== canvasBinding.submission_id) {
        return fail(400, "client_token 必须等于 canvas_binding.submission_id", {
          reason: RECOVERY_REASONS.invalidPayload,
        });
      }
    }

    // 契约 schema 复核（strict 三键）：粒度档枚举（fine / standard / coarse）在此拦截，
    // 档位→segment_threshold 数值翻译单源在契约 VIDEO_SCENE_SPLIT_SEGMENT_THRESHOLD（worker
    // 出站处换算，本入口不重复定义数值，只冻结枚举档）。
    const parsed = videoSceneSplitInputSchema.safeParse(businessBody);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoSceneSplitInput = parsed.data;
    const requestHash = requestHashOf(projectId, input, canvasBinding);

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // 单事务原子创建（先例 storyboard-preview-repo「零副作用前置」）：幂等命中判定、资产复核
    // 与两行写入（generation_jobs + command_idempotency）同一事务——重放是既有结果，不被此刻
    // 的素材状态改写（generation-command-repo guardInput 同口径）；同 token 并发竞态由
    // (project_id, operation, idempotency_key) 唯一键 + transactionWithUniqueRetry 收敛。
    // IKJJQY：携带 canvas_binding 时走恢复受理锁内核（项目→画布→锁内幂等回读→owner 版本
    // 核对；冲突在任务写入前零副作用拒绝），成功后随事务写 submission/owner 关联行。
    try {
      return await transactionWithUniqueRetry(this.prisma.client, async (tx) => {
      let recoveryPlan: CanvasRecoveryPlan | null = null;
      if (canvasBinding) {
        const acceptance: CanvasRecoveryAcceptance = {
          projectId,
          userId,
          binding: canvasBinding,
          operation: IDEMPOTENCY_OPERATION,
          requestHash,
          idempotencyKey: clientToken,
          taskType: VIDEO_SCENE_SPLIT_JOB_TYPE,
        };
        const locked = await lockCanvasRecoveryForAcceptance(tx, acceptance);
        if (locked.kind === "replay") {
          const replayed = await tx.generation_jobs.findUnique({
            where: { id: BigInt(locked.result.generation_job_id) },
            select: { status: true },
          });
          // 同 token 重放不重复建任务：返回原 job 与其当前状态 + 原关联视图（is_current 现查）。
          return ok({
            job_id: locked.result.generation_job_id,
            status: replayed?.status ?? "queued",
            canvas_binding: await canvasBindingView(
              this.prisma.client, projectId, canvasBinding.submission_id,
            ),
          });
        }
        if (locked.kind === "idempotency_conflict") {
          return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
        }
        recoveryPlan = locked.plan;
      } else {
        const existing = await tx.command_idempotency.findUnique({
          where: {
            project_id_operation_idempotency_key: {
              project_id: BigInt(projectId),
              operation: IDEMPOTENCY_OPERATION,
              idempotency_key: clientToken,
            },
          },
          select: { request_hash: true, generation_job_id: true },
        });
        if (existing) {
          if (existing.request_hash !== requestHash) {
            return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
          }
          if (existing.generation_job_id === null) {
            return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
          }
          const replayed = await tx.generation_jobs.findUnique({
            where: { id: existing.generation_job_id },
            select: { status: true },
          });
          if (!replayed) {
            return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
          }
          // 同 token 重放不重复建任务：返回首次 job_id 与其当前状态（前端照常轮询）。
          return ok({
            job_id: existing.generation_job_id.toString(),
            status: replayed.status,
          });
        }
      }

      // findOwnedSource 按 user_id 归属过滤（status=normal 且未删除）：非本人素材一律 404，
      // 不泄露存在性。
      const asset = await this.assets.findOwnedSource(
        input[VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId],
        userId,
      );
      if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
      if (asset.type !== "video") {
        return fail(FAILURE_CODE, "仅支持对视频资产发起场景切分");
      }

      // 输入门槛复核（官方 PDF 使用限制表「视频时长 ≤2 小时」；常量单源在契约
      // video-scene-split.ts，web 按钮门槛预检同源）。assets.duration_ms 由前端上报、存量
      // 大量为 null：缺权威值不臆造、不拦——放行交供应商按官方门槛拒（与去字幕 / HD 同口径）。
      if (asset.duration_ms != null && asset.duration_ms > VIDEO_SCENE_SPLIT_MAX_DURATION_MS) {
        return fail(FAILURE_CODE, "暂支持 2 小时以内的视频场景切分");
      }

      // 契约 schema parse 后原样冻结（重试原样沿用）。provider_credential 是业务键之上的
      // 基础设施键（不进契约 zod——凭证由服务端注入）：请求方 sk- 明文冻结进 job input，
      // worker（worker 票按附录 C 注册的处理器）处理时直接取用；未携带/非 sk- 时不写键。
      const frozenInput: VideoSceneSplitInput & { provider_credential?: string } = {
        ...input,
        ...(internal.providerCredential
          ? { provider_credential: internal.providerCredential }
          : {}),
      };

      const job = await tx.generation_jobs.create({
        data: {
          user_id: BigInt(userId),
          project_id: BigInt(projectId),
          type: VIDEO_SCENE_SPLIT_JOB_TYPE,
          source: VIDEO_SCENE_SPLIT_SOURCE,
          status: "queued",
          progress: 0,
          input: frozenInput,
          // 过去 60s：回拨口径同去字幕 / HD / media_extract——DATETIME(0) 秒精度进位会让
          // 同秒 claim 的 lte now 判 false，任务悬挂。
          next_action_at: new Date(Date.now() - 60_000),
        },
      });
      // 幂等行与任务行同事务（验收「任务记录与画布占位数据同事务创建」的原子性载体）：
      // accepted_cursor 无事件流语义，恒 0（表非空约束占位）。
      await tx.command_idempotency.create({
        data: {
          project_id: BigInt(projectId),
          operation: IDEMPOTENCY_OPERATION,
          idempotency_key: clientToken,
          request_hash: requestHash,
          generation_job_id: job.id,
          accepted_cursor: 0n,
        },
      });
      // IKJJQY：恢复关联行（submission + owner）与任务同事务（B.3 步骤 3）。
      if (recoveryPlan && canvasBinding) {
        await writeCanvasRecoveryRows(tx, recoveryPlan, job.id);
        return ok({
          job_id: job.id.toString(),
          status: "queued",
          // 受理视图（B.3 成功 data 新增字段）：刚受理必然拥有目标承接，is_current=true；
          // 事务内构造，不经 prisma.client 二次读（未提交数据不可见）。
          canvas_binding: {
            protocol_version: CANVAS_RECOVERY_PROTOCOL_VERSION,
            submission_id: canvasBinding.submission_id,
            target_node_id: canvasBinding.target_node_id,
            binding_revision: recoveryPlan.bindingRevision,
            job_id: job.id.toString(),
            is_current: true,
          },
        });
      }
      return ok({
        job_id: job.id.toString(),
        status: "queued",
      });
      });
    } catch (error) {
      // B.8：新协议受控错误信封直写（code=HTTP 状态），事务已随异常回滚。
      if (error instanceof RecoveryContractError) return error.envelope;
      throw error;
    }
  }

  /** 入队失败兜底：queued 任务直接置 failed，避免场景切分任务在 worker 领取前静默悬挂。
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
