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
  AUDIO_MIX_JOB_TYPE,
  AUDIO_MIX_SOURCE,
  GENERATION_ERROR_DETAIL_HTTP_STATUS,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  FAILURE_CODE,
  ERROR_ENQUEUE_FAILED,
  DomainError,
  audioMixCreateSchema,
  canvasBindingSchema,
  ok,
  recoveryError,
  type CanvasBinding,
  type RecoveryErrorEnvelope,
} from "@lib/contracts";

@Injectable()
export class AudioMixesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
    private readonly storage: AssetStorageService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: unknown,
    internal: { providerCredential?: string; idempotencyKey?: string } = {},
  ) {
    const parsed = audioMixCreateSchema.safeParse(body);
    if (!parsed.success) throw new DomainError(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音频混合参数非法");
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
      ? { project_id: BigInt(projectId), operation: "audio_mix.create", idempotency_key: idempotencyKey }
      : null;
    const replay = async () => {
      if (!key) return null;
      const existing = await this.prisma.client.command_idempotency.findUnique({
        where: { project_id_operation_idempotency_key: key },
      });
      if (!existing) return null;
      if (existing.request_hash !== hash || !existing.generation_job_id) {
        throw new DomainError(409, "幂等键已用于另一项音频混合创建");
      }
      const job = await this.prisma.client.generation_jobs.findFirst({
        where: { id: existing.generation_job_id, project_id: BigInt(projectId), user_id: BigInt(userId), type: AUDIO_MIX_JOB_TYPE },
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
    if (!uploads) throw new DomainError(FAILURE_CODE, "音频存储不可用");

    const frozenInputs: Array<{ asset_id: string; node_id?: string; url: string }> = new Array(parsed.data.inputs.length);
    const durations: Array<number | null> = new Array(parsed.data.inputs.length);
    const abort = new AbortController();
    let nextIndex = 0;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => {
        abort.abort();
        reject(new DomainError(FAILURE_CODE, "音频资产校验超时"));
      }, 15_000);
    });
    const resolveNext = async () => {
      while (!abort.signal.aborted && nextIndex < parsed.data.inputs.length) {
        const index = nextIndex++;
        const input = parsed.data.inputs[index]!;
        const asset = await this.assets.findOwnedSource(input.asset_id, userId);
        if (!asset) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
        if (asset.project_id !== BigInt(projectId) && asset.project_id !== 0n && !linkedIds.has(input.asset_id)) {
          throw new DomainError(RESOURCE_NOT_FOUND_CODE);
        }
        if (asset.type !== "audio" || !/^(https?:\/\/|mediakit:\/\/|vod:\/\/|tos:\/\/)/i.test(asset.url)) {
          throw new DomainError(FAILURE_CODE, "音频资产不可用");
        }
        let storageKey = asset.storage_key;
        if (!storageKey) {
          // 兼容历史 TOS Asset：已完成音频可能仅保留公网 URL，仍须限制在我方桶后还原 key 验对象。
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
            throw new DomainError(FAILURE_CODE, "音频资产不可用");
          }
        }
        let publicUrl: string;
        try {
          const object = await uploads.inspectObject(storageKey);
          if (!object || object.size <= 0 || new URL(object.publicUrl).protocol !== "https:") {
            throw new Error("音频对象不存在或无法公开读取");
          }
          const response = await fetch(object.publicUrl, {
            method: "GET",
            headers: { Range: "bytes=0-0" },
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]),
          });
          await response.body?.cancel();
          if (!response.ok) throw new Error(`音频公开读取失败: HTTP ${response.status}`);
          publicUrl = object.publicUrl;
        } catch {
          throw new DomainError(FAILURE_CODE, "音频资产不可用");
        }
        frozenInputs[index] = {
          asset_id: input.asset_id,
          ...(input.node_id ? { node_id: input.node_id } : {}),
          url: publicUrl,
        };
        durations[index] = asset.duration_ms == null || !Number.isFinite(asset.duration_ms) || asset.duration_ms < 0
          ? null : asset.duration_ms;
      }
    };
    try {
      await Promise.race([
        Promise.all(Array.from({ length: Math.min(8, parsed.data.inputs.length) }, () => resolveNext())),
        deadline,
      ]);
    } catch (error) {
      abort.abort();
      throw error;
    } finally {
      clearTimeout(deadlineTimer);
    }
    const estimatedDurationMs = durations.some((duration) => duration === null)
      ? null : Math.max(...(durations as number[]));

    const data = {
      user_id: BigInt(userId),
      project_id: BigInt(projectId),
      type: AUDIO_MIX_JOB_TYPE,
      source: AUDIO_MIX_SOURCE,
      status: "queued",
      progress: 0,
      input: {
        source_node_id: parsed.data.source_node_id,
        inputs: frozenInputs,
        output_format: parsed.data.output_format,
        estimated_duration_ms: estimatedDurationMs,
        ...(internal.providerCredential ? { provider_credential: internal.providerCredential } : {}),
      },
      next_action_at: new Date(Date.now() - 60_000),
      execution_deadline_at: audioMixDeadline(estimatedDurationMs),
    };
    if (!key) {
      const job = await this.prisma.client.generation_jobs.create({ data });
      return ok({ job_id: job.id.toString(), status: "queued", replayed: false, enqueue_required: true });
    }
    let job;
    let replayed = false;
    try {
      const result = await this.prisma.client.$transaction(async (tx) => {
        // IKJJQZ（B.3 步骤 2-3）：受理锁序先于任务写入——锁内幂等回读（命中同摘要=重放原关联）
        // → 节点归属版本比对（冲突在 job 写入前拒绝）→ 提交关联/归属行随 job 同一事务提交。
        let plan: CanvasRecoveryPlan | null = null;
        if (canvasBinding) {
          const locked = await lockCanvasRecoveryForAcceptance(tx, {
            projectId, userId, binding: canvasBinding,
            operation: "audio_mix.create", requestHash: hash,
            idempotencyKey, taskType: AUDIO_MIX_JOB_TYPE,
          });
          if (locked.kind === "replay") return { replayed: true, jobId: null as string | null };
          if (locked.kind === "idempotency_conflict") {
            throw new DomainError(409, "幂等键已用于另一项音频混合创建");
          }
          plan = locked.plan;
        }
        const created = await tx.generation_jobs.create({ data });
        await tx.command_idempotency.create({
          data: { ...key, request_hash: hash, generation_job_id: created.id, accepted_cursor: 0n },
        });
        if (plan) await writeCanvasRecoveryRows(tx, plan, created.id);
        return { replayed: false, jobId: created.id.toString() as string | null };
      });
      replayed = result.replayed;
      job = result.jobId;
    } catch (error) {
      if (error instanceof RecoveryContractError) return error.envelope;
      const existing = await replay();
      if (existing) return existing;
      throw error;
    }
    if (replayed) return this.withBindingView((await replay())!, projectId, canvasBinding);
    // IKJJQZ：成功 data 追加 canvas_binding 视图（重放与首次受理同形；is_current 现查 owner）。
    return this.withBindingView(
      ok({ job_id: job, status: "queued", replayed: false, enqueue_required: true }),
      projectId,
      canvasBinding,
    );
  }

  /** IKJJQZ（IKIXK9-SPEC-20261002 B.3）：专属重试可携带 canvas_binding（新 submission_id =
   *  独立提交意图，同 jobId 不等于同提交意图）。任务重置（CAS failed→queued）与归属版本
   *  推进（owner 指向新提交、旧关联 transferred）在同一最外层事务；绑定冲突在任务重置前
   *  拒绝。未携带走历史路径零变化。 */
  async retry(
    userId: string,
    projectId: string,
    jobId: string,
    idempotencyKey: string,
    providerCredential?: string,
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
      where: { id: jid, project_id: pid, user_id: BigInt(userId), type: AUDIO_MIX_JOB_TYPE,
        source: AUDIO_MIX_SOURCE, is_delete: false },
      select: { id: true },
    });
    if (!owned) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
    // IKJJQZ（B.3）：请求摘要覆盖完整 canvas_binding（zod 输出按 schema 键序，stringify 即规范化）。
    const hash = createHash("sha256").update(
      `POST:audio_mix.retry:${projectId}:${jobId}${canvasBinding ? `:${JSON.stringify(canvasBinding)}` : ""}`,
    ).digest("hex");
    const key = { project_id: pid, operation: "audio_mix.retry", idempotency_key: idempotencyKey };
    const replay = async () => {
      const existing = await this.prisma.client.command_idempotency.findUnique({
        where: { project_id_operation_idempotency_key: key },
      });
      if (!existing) return null;
      if (existing.request_hash !== hash || existing.generation_job_id !== jid) {
        throw new DomainError(409, "幂等键已用于另一项音频混合重试");
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
            operation: "audio_mix.retry", requestHash: hash,
            idempotencyKey, taskType: AUDIO_MIX_JOB_TYPE,
          });
          if (locked.kind === "replay") return { replayed: true };
          if (locked.kind === "idempotency_conflict") {
            throw new DomainError(409, "幂等键已用于另一项音频混合重试");
          }
          if (locked.kind === "error") throw new RecoveryContractError(locked.envelope);
          const rejected = await verifyDedicatedMixRetryTarget(tx, pid, jid, canvasBinding.target_node_id);
          if (rejected) throw new RecoveryContractError(rejected);
          plan = locked.plan;
        }
        if (!canvasBinding) {
          const existing = await tx.command_idempotency.findUnique({
            where: { project_id_operation_idempotency_key: key },
          });
          if (existing) {
            if (existing.request_hash !== hash || existing.generation_job_id !== jid) {
              throw new DomainError(409, "幂等键已用于另一项音频混合重试");
            }
            return { replayed: true };
          }
        }
        const job = await tx.generation_jobs.findFirst({
          where: { id: jid, project_id: pid, user_id: BigInt(userId), type: AUDIO_MIX_JOB_TYPE,
            source: AUDIO_MIX_SOURCE, is_delete: false },
        });
        if (!job) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
        if (job.status !== "failed") throw new DomainError(409, "只有失败的音频混合任务可重试");
        const frozen = job.input as { estimated_duration_ms?: unknown } | null;
        const duration = typeof frozen?.estimated_duration_ms === "number" ? frozen.estimated_duration_ms : null;
        const previousError = job.error;
        const unauthorized = isUpstreamUnauthorized(previousError);
        const refreshedInput = unauthorized && providerCredential && frozen
          ? { ...frozen, provider_credential: providerCredential } as Prisma.InputJsonValue
          : undefined;
        const updated = await tx.generation_jobs.updateMany({
          where: { id: jid, status: "failed", fencing_token: job.fencing_token },
          data: {
            status: "queued", progress: 0, error: Prisma.DbNull, output_asset_ids: Prisma.DbNull,
            provider_task_id: null, poll_count: 0,
            next_action_at: new Date(Date.now() - 60_000),
            execution_deadline_at: audioMixDeadline(duration),
            lease_owner: null, lease_expires_at: null,
            ...(refreshedInput ? { input: refreshedInput } : {}),
            fencing_token: { increment: 1 }, retry_count: { increment: 1 }, version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new DomainError(409, "音频混合任务正在重试");
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

function audioMixDeadline(estimatedDurationMs: number | null): Date {
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
 *  只接受 job 冻结 input 的固定源卡（inputs[0] 的画布音频卡）作可信原卡关联，
 *  不能证明关联就按历史规则拒绝迁移。返回非空即 422 拒绝信封。 */
async function verifyDedicatedMixRetryTarget(
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
    const source = (job?.input as { source_node_id?: unknown } | null)?.source_node_id;
    if (typeof source === "string" && source.length > 0) trusted = source;
  }
  if (trusted === targetNodeId) return null;
  return recoveryError(
    422, "专属重试目标与原受理关联不符，不能改绑同 jobId 的承接目标",
    RECOVERY_REASONS.documentMismatch,
  );
}

/** 上游 401 判定（IKIHGQ）：error.details 的结构化 HTTP 状态（worker 写入）存在即以它为准；
 *  仅旧任务数据（无数值状态）回退 message 文案正则——文案措辞变化不影响换凭证重试。 */
function isUpstreamUnauthorized(previousError: unknown): boolean {
  if (!previousError || typeof previousError !== "object" || Array.isArray(previousError)) return false;
  const record = previousError as Record<string, unknown>;
  const details = record.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const status = (details as Record<string, unknown>)[GENERATION_ERROR_DETAIL_HTTP_STATUS];
    if (typeof status === "number") return status === 401;
  }
  return typeof record.message === "string" && /\bHTTP 401\b/.test(record.message);
}
