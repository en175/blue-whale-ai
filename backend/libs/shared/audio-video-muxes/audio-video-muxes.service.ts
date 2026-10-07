import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { loadTosStorageConfig } from "@lib/shared/assets/tos-storage.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
// IKJJQZ：恢复契约受理锁内核复用（深路径导入，不改 QU 共享 index 导出面）。
import {
  RecoveryContractError,
  canvasBindingView,
  lockCanvasRecoveryForAcceptance,
  lockCanvasRecoveryForRetry,
  writeCanvasRecoveryRows,
} from "@lib/shared/persistence/generation-canvas-recovery-repo.js";
import type { CanvasRecoveryPlan } from "@lib/shared/persistence/generation-canvas-recovery-repo.js";
import {
  AUDIO_VIDEO_MUX_JOB_TYPE,
  AUDIO_VIDEO_MUX_SOURCE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  FAILURE_CODE,
  ERROR_ENQUEUE_FAILED,
  DomainError,
  audioVideoMuxCreateSchema,
  canvasBindingSchema,
  ok,
  recoveryError,
  type CanvasBinding,
  type RecoveryErrorEnvelope,
} from "@lib/contracts";

/** 冻结快照里的单输入（对象内 camel 命名 + 服务端解析 URL；迁移契约 §21.2）。 */
type FrozenMuxInput = { assetId: string; nodeId?: string; url: string };

@Injectable()
export class AudioVideoMuxesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
    private readonly storage: AssetStorageService,
  ) {}

  /** 创建入口（IKIHPJ，免费任务：无积分冻结、无成本预留、无余额拦截）。
   *  权威复核两份资产归属/媒体类型/URL 协议白名单/公开可读后冻结输入快照；拒绝时不留任务。
   *  幂等双轨（IKILVF）：Idempotency-Key + command_idempotency 表（operation
   *  audio_video_mux.create），同键同内容重放原任务、同键异内容 409；创建任务与幂等
   *  记录同事务落库，唯一约束冲突回落重放（与 audio_mix.create 同一套口径）。 */
  async create(
    userId: string,
    projectId: string,
    body: unknown,
    internal: { providerCredential?: string; idempotencyKey?: string } = {},
  ) {
    const parsed = audioVideoMuxCreateSchema.safeParse(body);
    if (!parsed.success) throw new DomainError(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音视频合成参数非法");
    const idempotencyKey = internal.idempotencyKey ?? "";
    if (idempotencyKey && !/^[!-~]{1,128}$/.test(idempotencyKey)) {
      throw new DomainError(PARAM_MISSING_CODE, "Idempotency-Key 必须为 1–128 个可打印非空白字符");
    }
    // IKJJQZ（B.3 第 1 步）：canvas_binding 纯载荷校验——Idempotency-Key 必须等于 submission_id，
    // 携带绑定时强制要求幂等键；未携带走历史路径零变化。
    const canvasBinding = parsed.data.canvas_binding ?? null;
    if (canvasBinding && (!idempotencyKey || idempotencyKey !== canvasBinding.submission_id)) {
      return recoveryError(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", RECOVERY_REASONS.invalidPayload);
    }

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
    const hash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
    const key = idempotencyKey
      ? { project_id: BigInt(projectId), operation: "audio_video_mux.create", idempotency_key: idempotencyKey }
      : null;
    const replay = async () => {
      if (!key) return null;
      const existing = await this.prisma.client.command_idempotency.findUnique({
        where: { project_id_operation_idempotency_key: key },
      });
      if (!existing) return null;
      if (existing.request_hash !== hash || !existing.generation_job_id) {
        throw new DomainError(409, "幂等键已用于另一项音视频合成创建");
      }
      const job = await this.prisma.client.generation_jobs.findFirst({
        where: { id: existing.generation_job_id, project_id: BigInt(projectId), user_id: BigInt(userId), type: AUDIO_VIDEO_MUX_JOB_TYPE },
        select: { id: true, status: true, version: true, error: true },
      });
      if (!job) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
      const error = job.error;
      if (job.status === "failed" && error && typeof error === "object" && !Array.isArray(error)
          && "code" in error && error.code === ERROR_ENQUEUE_FAILED) {
        const resumed = await this.prisma.client.generation_jobs.updateMany({
          where: { id: job.id, status: "failed", version: job.version },
          data: { status: "queued", error: Prisma.DbNull, next_action_at: new Date(Date.now() - 60_000), version: { increment: 1 } },
        });
        if (resumed.count === 1) return ok({ job_id: job.id.toString(), status: "queued", replayed: true, enqueue_required: true });
      }
      const latest = await this.prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: job.id }, select: { status: true } });
      return ok({ job_id: job.id.toString(), status: latest.status, replayed: true, enqueue_required: false });
    };
    const previous = await replay();
    if (previous) return this.withBindingView(previous, projectId, canvasBinding);

    const links = await this.prisma.client.project_asset.findMany({
      where: { user_id: BigInt(userId), project_id: BigInt(projectId), is_delete: 0 },
      select: { asset_id: true },
    });
    const linkedIds = new Set(links.map((link) => link.asset_id.toString()));
    const uploads = this.storage.uploads;
    if (!uploads) throw new DomainError(FAILURE_CODE, "音视频存储不可用");

    const abort = new AbortController();
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => {
        abort.abort();
        reject(new DomainError(FAILURE_CODE, "媒体资产校验超时"));
      }, 15_000);
    });
    const resolveSlot = async (
      input: { assetId: string; nodeId?: string | undefined },
      expectedType: "audio" | "video",
    ): Promise<{ frozen: FrozenMuxInput; durationMs: number | null }> => {
      const label = expectedType === "audio" ? "音频" : "视频";
      const asset = await this.assets.findOwnedSource(input.assetId, userId);
      if (!asset) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
      if (asset.project_id !== BigInt(projectId) && asset.project_id !== 0n && !linkedIds.has(input.assetId)) {
        throw new DomainError(RESOURCE_NOT_FOUND_CODE);
      }
      // 协议白名单与迁移契约 §21.1 冻结一致（https/mediakit/vod/tos，不含 http）：http URL
      // 即使 storage_key 存在也不放行——冻结 url 恒取 inspectObject 的 https publicUrl，
      // http 的 asset.url 从来不能成为任务输入（无 storage_key 时 TOS origin 还原也只认 https）。
      if (asset.type !== expectedType || !/^(https:\/\/|mediakit:\/\/|vod:\/\/|tos:\/\/)/i.test(asset.url)) {
        throw new DomainError(FAILURE_CODE, `${label}资产不可用`);
      }
      let storageKey = asset.storage_key;
      if (!storageKey) {
        // 兼容历史 TOS Asset：可能仅保留公网 URL，仍须限制在我方桶后还原 key 验对象。
        const config = loadTosStorageConfig();
        const endpoint = config?.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const origin = config ? `https://${config.bucket}.${endpoint}` : null;
        try {
          const url = new URL(asset.url);
          if (!origin || url.origin !== origin || !url.pathname || url.pathname === "/" || url.search) {
            throw new Error("不是我方 TOS 公网对象");
          }
          storageKey = decodeURIComponent(url.pathname.slice(1));
        } catch {
          throw new DomainError(FAILURE_CODE, `${label}资产不可用`);
        }
      }
      let publicUrl: string;
      try {
        const object = await uploads.inspectObject(storageKey);
        if (!object || object.size <= 0 || new URL(object.publicUrl).protocol !== "https:") {
          throw new Error(`${label}对象不存在或无法公开读取`);
        }
        const response = await fetch(object.publicUrl, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error(`${label}公开读取失败: HTTP ${response.status}`);
        publicUrl = object.publicUrl;
      } catch {
        throw new DomainError(FAILURE_CODE, `${label}资产不可用`);
      }
      return {
        frozen: {
          assetId: input.assetId,
          ...(input.nodeId ? { nodeId: input.nodeId } : {}),
          url: publicUrl,
        },
        durationMs: asset.duration_ms == null || !Number.isFinite(asset.duration_ms) || asset.duration_ms < 0
          ? null : asset.duration_ms,
      };
    };

    let audioSlot: { frozen: FrozenMuxInput; durationMs: number | null };
    let videoSlot: { frozen: FrozenMuxInput; durationMs: number | null };
    try {
      [audioSlot, videoSlot] = await Promise.race([
        Promise.all([
          resolveSlot(parsed.data.audio, "audio"),
          resolveSlot(parsed.data.video, "video"),
        ]),
        deadline,
      ]);
    } catch (error) {
      abort.abort();
      throw error;
    } finally {
      clearTimeout(deadlineTimer);
    }
    // 估算时长取源视频资产时长毫秒（IKIHPJ 拍板⑥）；缺失走未知 7d 预算。
    const estimatedDurationMs = videoSlot.durationMs;

    const data = {
      user_id: BigInt(userId),
      project_id: BigInt(projectId),
      type: AUDIO_VIDEO_MUX_JOB_TYPE,
      source: AUDIO_VIDEO_MUX_SOURCE,
      status: "queued",
      progress: 0,
      input: {
        audio: audioSlot.frozen,
        video: videoSlot.frozen,
        is_audio_reserve: parsed.data.is_audio_reserve,
        sync: parsed.data.sync,
        estimated_duration_ms: estimatedDurationMs,
        submit_attempt: 1,
        ...(internal.providerCredential ? { provider_credential: internal.providerCredential } : {}),
      },
      next_action_at: new Date(Date.now() - 60_000),
      execution_deadline_at: audioVideoMuxDeadline(estimatedDurationMs),
    };
    if (!key) {
      const job = await this.prisma.client.generation_jobs.create({ data });
      return ok({ job_id: job.id.toString(), status: "queued", replayed: false, enqueue_required: true });
    }
    let jobIdOfCreated = "";
    let replayed = false;
    try {
      const result = await this.prisma.client.$transaction(async (tx) => {
        // IKJJQZ（B.3 步骤 2-3）：受理锁序先于任务写入——锁内幂等回读（命中同摘要=重放原关联）
        // → 节点归属版本比对（冲突在 job 写入前拒绝）→ 提交关联/归属行随 job 同一事务提交。
        let plan: CanvasRecoveryPlan | null = null;
        if (canvasBinding) {
          const locked = await lockCanvasRecoveryForAcceptance(tx, {
            projectId, userId, binding: canvasBinding,
            operation: "audio_video_mux.create", requestHash: hash,
            idempotencyKey, taskType: AUDIO_VIDEO_MUX_JOB_TYPE,
          });
          if (locked.kind === "replay") return { replayed: true, jobId: null };
          if (locked.kind === "idempotency_conflict") {
            throw new DomainError(409, "幂等键已用于另一项音视频合成创建");
          }
          plan = locked.plan;
        }
        const created = await tx.generation_jobs.create({ data });
        await tx.command_idempotency.create({
          data: { ...key, request_hash: hash, generation_job_id: created.id, accepted_cursor: 0n },
        });
        if (plan) await writeCanvasRecoveryRows(tx, plan, created.id);
        return { replayed: false, jobId: created.id.toString() };
      });
      replayed = result.replayed;
      jobIdOfCreated = result.jobId ?? "";
    } catch (error) {
      if (error instanceof RecoveryContractError) return error.envelope;
      const existing = await replay();
      if (existing) return existing;
      throw error;
    }
    if (replayed) return this.withBindingView((await replay())!, projectId, canvasBinding);
    // IKJJQZ：成功 data 追加 canvas_binding 视图（重放与首次受理同形；is_current 现查 owner）。
    return this.withBindingView(
      ok({ job_id: jobIdOfCreated, status: "queued", replayed: false, enqueue_required: true }),
      projectId,
      canvasBinding,
    );
  }

  /** 重试入口（IKIHPL）：读冻结快照重放，不读画布当前选中态、不重新解析资产 URL；
   *  快照缺失或输入资产已删除时给出明确拒绝原因。仅 failed 态可重试，其他状态拒绝。
   *  幂等双轨：Idempotency-Key + command_idempotency 表（operation audio_video_mux.retry），
   *  同事务 CAS failed→queued；免费任务同创建：无积分冻结、无成本预留、无余额拦截。
   *  IKJJQZ（B.3）：专属重试可携带 canvas_binding（新 submission_id = 独立提交意图，同 jobId
   *  不等于同提交意图）。任务重置与归属版本推进在同一最外层事务；绑定冲突在任务重置前
   *  拒绝。未携带走历史路径零变化。 */
  async retry(
    userId: string,
    projectId: string,
    jobId: string,
    idempotencyKey: string,
    canvasBindingBody?: unknown,
  ) {
    if (!/^[!-~]{1,128}$/.test(idempotencyKey)) {
      throw new DomainError(PARAM_MISSING_CODE, "Idempotency-Key 必须为 1–128 个可打印非空白字符");
    }
    // IKJJQZ（B.3 第 1 步）：canvas_binding 纯载荷校验（Idempotency-Key 必须等于 submission_id）。
    const canvasBinding = parseDedicatedRetryBinding(canvasBindingBody, idempotencyKey);
    if (canvasBinding !== null && "code" in canvasBinding) return canvasBinding;
    if (!/^[1-9][0-9]*$/.test(jobId) || !/^[1-9][0-9]*$/.test(projectId)) {
      throw new DomainError(RESOURCE_NOT_FOUND_CODE);
    }
    const pid = BigInt(projectId);
    const jid = BigInt(jobId);
    const owned = await this.prisma.client.generation_jobs.findFirst({
      where: { id: jid, project_id: pid, user_id: BigInt(userId), type: AUDIO_VIDEO_MUX_JOB_TYPE,
        source: AUDIO_VIDEO_MUX_SOURCE, is_delete: false },
      select: { id: true },
    });
    if (!owned) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
    // IKJJQZ（B.3）：请求摘要覆盖完整 canvas_binding（zod 输出按 schema 键序，stringify 即规范化）。
    const hash = createHash("sha256").update(
      `POST:audio_video_mux.retry:${projectId}:${jobId}${canvasBinding ? `:${JSON.stringify(canvasBinding)}` : ""}`,
    ).digest("hex");
    const key = { project_id: pid, operation: "audio_video_mux.retry", idempotency_key: idempotencyKey };
    const replay = async () => {
      const existing = await this.prisma.client.command_idempotency.findUnique({
        where: { project_id_operation_idempotency_key: key },
      });
      if (!existing) return null;
      if (existing.request_hash !== hash || existing.generation_job_id !== jid) {
        throw new DomainError(409, "幂等键已用于另一项音视频合成重试");
      }
      const current = await this.prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: jid } });
      const error = current.error;
      if (current.status === "failed" && error && typeof error === "object" && !Array.isArray(error)
          && "code" in error && error.code === ERROR_ENQUEUE_FAILED) {
        const resumed = await this.prisma.client.generation_jobs.updateMany({
          where: { id: jid, status: "failed", version: current.version },
          data: { status: "queued", error: Prisma.DbNull, next_action_at: new Date(Date.now() - 60_000),
            version: { increment: 1 } },
        });
        if (resumed.count === 1) return ok({ job_id: jobId, status: "queued", replayed: true, enqueue_required: true });
      }
      const latest = await this.prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: jid }, select: { status: true } });
      return ok({ job_id: jobId, status: latest.status, replayed: true, enqueue_required: false });
    };
    try {
      const result = await this.prisma.client.$transaction(async (tx) => {
        // IKJJQZ：受理锁序先于任务重置——锁内幂等回读（命中同摘要=重放原关联）→
        // 节点归属版本比对（冲突在 CAS 前拒绝、零写入）→ 专属重试关联校验（不得改绑）。
        let plan: CanvasRecoveryPlan | null = null;
        if (canvasBinding) {
          const locked = await lockCanvasRecoveryForRetry(tx, {
            projectId, userId, binding: canvasBinding,
            operation: "audio_video_mux.retry", requestHash: hash,
            idempotencyKey, taskType: AUDIO_VIDEO_MUX_JOB_TYPE,
          });
          if (locked.kind === "replay") return { replayed: true };
          if (locked.kind === "idempotency_conflict") {
            throw new DomainError(409, "幂等键已用于另一项音视频合成重试");
          }
          if (locked.kind === "error") throw new RecoveryContractError(locked.envelope);
          const rejected = await verifyDedicatedMuxRetryTarget(tx, pid, jid, canvasBinding.target_node_id);
          if (rejected) throw new RecoveryContractError(rejected);
          plan = locked.plan;
        }
        if (!canvasBinding) {
          const existing = await tx.command_idempotency.findUnique({
            where: { project_id_operation_idempotency_key: key },
          });
          if (existing) {
            if (existing.request_hash !== hash || existing.generation_job_id !== jid) {
              throw new DomainError(409, "幂等键已用于另一项音视频合成重试");
            }
            return { replayed: true };
          }
        }
        const job = await tx.generation_jobs.findFirst({
          where: { id: jid, project_id: pid, user_id: BigInt(userId), type: AUDIO_VIDEO_MUX_JOB_TYPE,
            source: AUDIO_VIDEO_MUX_SOURCE, is_delete: false },
        });
        if (!job) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
        if (job.status !== "failed") throw new DomainError(409, "只有失败的音视频合成任务可重试");
        const frozen = job.input as {
          audio?: { assetId?: unknown };
          video?: { assetId?: unknown };
          estimated_duration_ms?: unknown;
          submit_attempt?: unknown;
        } | null;
        const audioAssetId = frozen?.audio?.assetId;
        const videoAssetId = frozen?.video?.assetId;
        const attempt = frozen?.submit_attempt;
        const snapshotUsable = typeof audioAssetId === "string" && /^[1-9][0-9]*$/.test(audioAssetId)
          && typeof videoAssetId === "string" && /^[1-9][0-9]*$/.test(videoAssetId)
          && typeof attempt === "number" && Number.isInteger(attempt) && attempt >= 1;
        if (!frozen || !snapshotUsable) throw new DomainError(409, "冻结快照缺失，无法重试音视频合成");
        // 冻结输入资产仍须存活：软删（is_delete）或物理删除都视为已删除，明确拒绝。
        const living = await tx.assets.findMany({
          where: { id: { in: [BigInt(audioAssetId), BigInt(videoAssetId)] }, is_delete: false },
          select: { id: true },
        });
        if (living.length !== 2) throw new DomainError(409, "输入资产已删除，无法重试音视频合成");
        const duration = typeof frozen.estimated_duration_ms === "number" ? frozen.estimated_duration_ms : null;
        const updated = await tx.generation_jobs.updateMany({
          where: { id: jid, status: "failed", fencing_token: job.fencing_token },
          data: {
            status: "queued", progress: 0, error: Prisma.DbNull, output_asset_ids: Prisma.DbNull,
            provider_task_id: null, poll_count: 0,
            next_action_at: new Date(Date.now() - 60_000),
            execution_deadline_at: audioVideoMuxDeadline(duration),
            lease_owner: null, lease_expires_at: null,
            // 冻结快照不动：仅递增 submit_attempt。worker 的 client_token 从 (jobId, submit_attempt)
            // 派生（契约 audioVideoMuxClientToken），递增即换新 token，不被供应商按旧 token 去重。
            input: { ...frozen, submit_attempt: attempt + 1 } as Prisma.InputJsonValue,
            fencing_token: { increment: 1 }, retry_count: { increment: 1 }, version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new DomainError(409, "音视频合成任务正在重试");
        await tx.command_idempotency.create({
          data: { ...key, request_hash: hash, generation_job_id: jid, accepted_cursor: 0n },
        });
        // IKJJQZ：归属版本推进（owner 指向新提交、旧承接项 transferred）与任务重置同一事务。
        if (plan) await writeCanvasRecoveryRows(tx, plan, jid);
        return { replayed: false };
      });
      if (result.replayed) return this.withBindingView((await replay())!, projectId, canvasBinding);
      return this.withBindingView(
        ok({ job_id: jobId, status: "queued", replayed: false, enqueue_required: true }),
        projectId, canvasBinding,
      );
    } catch (error) {
      if (error instanceof RecoveryContractError) return error.envelope;
      if (error instanceof DomainError && error.status !== 409) throw error;
      const existing = await replay();
      if (existing) return this.withBindingView(existing, projectId, canvasBinding);
      throw error;
    }
  }


  /** IKJJQZ：携带绑定时在响应 data 上追加 canvas_binding 视图（首次受理与重放同形，
   *  is_current 现查 owner、不将旧关联重新设为当前）。 */
  private async withBindingView<T extends { data: unknown }>(
    result: T,
    projectId: string,
    canvasBinding: CanvasBinding | null,
  ): Promise<T> {
    if (!canvasBinding) return result;
    const view = await canvasBindingView(this.prisma.client, projectId, canvasBinding.submission_id);
    if (!view) return result;
    const data = (result.data ?? {}) as Record<string, unknown>;
    return { ...result, data: { ...data, canvas_binding: view } } as T;
  }

  async markFailed(jobId: string, code: string, message: string): Promise<string> {
    await createGenerationCommandRepo(this.prisma.client).markFailedQueued(jobId, code, message);
    const current = await this.prisma.client.generation_jobs.findUniqueOrThrow({
      where: { id: BigInt(jobId) }, select: { status: true },
    });
    return current.status;
  }
}

/** 超时预算（迁移契约 §21.1）：max(1d, 4×估算+6h)、未知 7d、上限 365d。 */
function audioVideoMuxDeadline(estimatedDurationMs: number | null): Date {
  const day = 24 * 60 * 60 * 1000;
  const budget = estimatedDurationMs !== null && Number.isFinite(estimatedDurationMs) && estimatedDurationMs > 0
    ? Math.max(day, estimatedDurationMs * 4 + 6 * 60 * 60 * 1000)
    : 7 * day;
  return new Date(Date.now() + Math.min(budget, 365 * day));
}

/** IKJJQZ（B.3）：专属重试的 canvas_binding 解析。无 binding 返回 null；
 *  非法或与 Idempotency-Key 不一致返回 400 受控信封。 */
function parseDedicatedRetryBinding(
  canvasBindingBody: unknown,
  idempotencyKey: string,
): CanvasBinding | RecoveryErrorEnvelope | null {
  if (canvasBindingBody === undefined || canvasBindingBody === null) return null;
  const parsed = canvasBindingSchema.safeParse(canvasBindingBody);
  if (!parsed.success) {
    return recoveryError(400, "canvas_binding 载荷无效", RECOVERY_REASONS.invalidPayload);
  }
  if (idempotencyKey !== parsed.data.submission_id) {
    return recoveryError(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", RECOVERY_REASONS.invalidPayload);
  }
  return parsed.data;
}

/** IKJJQZ（B.3 末段）：原卡专属重试从原受理关联解析目标并核对客户端值——
 *  有原关联则目标必须一致（不得把同 jobId 改绑新目标）；历史任务首次加入新协议
 *  只接受 job 冻结 input 的音频草稿卡（audio.nodeId，合成在原草稿卡生成）作可信
 *  原卡关联，不能证明关联就按历史规则拒绝迁移。返回非空即 422 拒绝信封。 */
async function verifyDedicatedMuxRetryTarget(
  tx: Prisma.TransactionClient,
  pid: bigint,
  jid: bigint,
  targetNodeId: string,
): Promise<RecoveryErrorEnvelope | null> {
  const prior = await tx.generation_canvas_submissions.findFirst({
    where: { project_id: pid, generation_job_id: jid },
    orderBy: { id: "desc" },
  });
  let trusted: string | null = prior?.target_node_id ?? null;
  if (trusted === null) {
    const job = await tx.generation_jobs.findUnique({ where: { id: jid }, select: { input: true } });
    const audioNode = (job?.input as { audio?: { nodeId?: unknown } } | null)?.audio?.nodeId;
    if (typeof audioNode === "string" && audioNode.length > 0) trusted = audioNode;
  }
  if (trusted === targetNodeId) return null;
  return recoveryError(
    422, "专属重试目标与原受理关联不符，不能改绑同 jobId 的承接目标",
    RECOVERY_REASONS.documentMismatch,
  );
}
