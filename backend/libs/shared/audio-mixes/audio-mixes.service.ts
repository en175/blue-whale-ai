import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { loadTosStorageConfig } from "@lib/shared/assets/tos-storage.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { markFailedQueuedAndNotifyBilling } from "@lib/shared/persistence/index.js";
import { withBillingCompensation } from "@lib/shared/persistence/job-billing.js";
import { resolveSourceDuration } from "@lib/shared/media-tools/source-duration.js";
import { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";
import {
  RecoveryContractError,
  canvasBindingView,
  lockCanvasRecoveryForAcceptance,
  lockCanvasRecoveryForRetry,
  writeCanvasRecoveryRows,
} from "@lib/shared/persistence/generation-canvas-recovery-repo.js";
import type { CanvasRecoveryPlan } from "@lib/shared/persistence/generation-canvas-recovery-repo.js";
import {
  ASSET_UNAVAILABLE_CODE,
  AUDIO_MIX_JOB_TYPE,
  AUDIO_MIX_SOURCE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  FAILURE_CODE,
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
    private readonly billing: MediaToolBillingService,
  ) {}
  async create(
    userId: string,
    projectId: string,
    body: unknown,
    internal: { idempotencyKey?: string } = {},
  ) {
    const parsed = audioMixCreateSchema.safeParse(body);
    if (!parsed.success) throw new DomainError(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音频混合参数非法");
    const idempotencyKey = internal.idempotencyKey ?? "";
    if (idempotencyKey && !/^[!-~]{1,128}$/.test(idempotencyKey)) {
      throw new DomainError(PARAM_MISSING_CODE, "Idempotency-Key 必须为 1–128 个可打印非空白字符");
    }
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
        select: { id: true, status: true },
      });
      if (!job) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
      return ok({ job_id: job.id.toString(), status: job.status, replayed: true, enqueue_required: false });
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
        const resolved = await resolveSourceDuration({
          prisma: this.prisma.client,
          storage: this.storage,
          asset: {
            id: input.asset_id,
            storage_key: storageKey,
            duration_ms: asset.duration_ms,
          },
        });
        if (resolved === null) {
          throw new DomainError(
            ASSET_UNAVAILABLE_CODE,
            "音频时长读取失败，请稍后重试或更换素材",
            503,
          );
        }
        durations[index] = resolved.durationMs;
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
    if (durations.some((duration) => duration === null)) {
      throw new DomainError(
        ASSET_UNAVAILABLE_CODE,
        "音频时长读取失败，请稍后重试或更换素材",
        503,
      );
    }
    const estimatedDurationMs = Math.max(...(durations as number[]));
    const durationSeconds = Math.max(1, Math.ceil(estimatedDurationMs / 1000));

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
        duration: durationSeconds,
      },
      next_action_at: new Date(Date.now() - 60_000),
      execution_deadline_at: audioMixDeadline(estimatedDurationMs),
    };
    const jobBilling = await this.billing.jobBilling(AUDIO_MIX_JOB_TYPE, userId, {
      duration: durationSeconds,
    });
    if (!key) {
      const job = await withBillingCompensation(jobBilling, (billing) =>
        this.prisma.client.$transaction(
          async (tx) => {
            const created = await tx.generation_jobs.create({ data });
            await billing?.charge(Number(created.id));
            return created;
          },
          { maxWait: 10_000, timeout: 30_000 },
        ),
      );
      return ok({ job_id: job.id.toString(), status: "queued", replayed: false, enqueue_required: true });
    }
    let job;
    let replayed = false;
    try {
      const result = await withBillingCompensation(jobBilling, (billing) =>
        this.prisma.client.$transaction(async (tx) => {
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
        await billing?.charge(Number(created.id));
        await tx.command_idempotency.create({
          data: { ...key, request_hash: hash, generation_job_id: created.id, accepted_cursor: 0n },
        });
        if (plan) await writeCanvasRecoveryRows(tx, plan, created.id);
        return { replayed: false, jobId: created.id.toString() as string | null };
        }),
      );
      replayed = result.replayed;
      job = result.jobId;
    } catch (error) {
      if (error instanceof RecoveryContractError) return error.envelope;
      const existing = await replay();
      if (existing) return existing;
      throw error;
    }
    if (replayed) return this.withBindingView((await replay())!, projectId, canvasBinding);
    return this.withBindingView(
      ok({ job_id: job, status: "queued", replayed: false, enqueue_required: true }),
      projectId,
      canvasBinding,
    );
  }

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
      select: { id: true, status: true, input: true },
    });
    if (!owned) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
    const frozenOwned = owned.input as { duration?: unknown; estimated_duration_ms?: unknown } | null;
    const retrySeconds = typeof frozenOwned?.duration === "number"
      ? frozenOwned.duration
      : typeof frozenOwned?.estimated_duration_ms === "number"
        ? Math.max(1, Math.ceil(frozenOwned.estimated_duration_ms / 1000))
        : null;
    if (retrySeconds === null) {
      throw new DomainError(FAILURE_CODE, "任务缺少计费时长，无法重试");
    }
    const retryEstimatedMs = typeof frozenOwned?.estimated_duration_ms === "number"
      ? frozenOwned.estimated_duration_ms
      : retrySeconds * 1000;
    const retryInput = { ...(frozenOwned ?? {}), duration: retrySeconds };
    const retryBilling = await this.billing.jobBilling(AUDIO_MIX_JOB_TYPE, userId, retryInput);
    const hash = createHash("sha256").update(
      `POST:audio_mix.retry:${projectId}:${jobId}${canvasBinding ? `:${JSON.stringify(canvasBinding)}` : ""}`,
    ).digest("hex");
    const key = { project_id: pid, operation: "audio_mix.retry", idempotency_key: idempotencyKey };
    const replay = async () => {
      const existing = await this.prisma.client.command_idempotency.findUnique({
        where: { project_id_operation_idempotency_key: key },
      });
      if (!existing) return null;
      if (existing.request_hash !== hash || !existing.generation_job_id) {
        throw new DomainError(409, "幂等键已用于另一项音频混合重试");
      }
      const current = await this.prisma.client.generation_jobs.findUniqueOrThrow({
        where: { id: existing.generation_job_id },
        select: { status: true },
      });
      return ok({
        job_id: existing.generation_job_id.toString(),
        status: current.status,
        replayed: true,
        enqueue_required: false,
      });
    };
    try {
      const result = await withBillingCompensation(retryBilling, (billing) =>
        this.prisma.client.$transaction(async (tx) => {
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
            if (existing.request_hash !== hash || !existing.generation_job_id) {
              throw new DomainError(409, "幂等键已用于另一项音频混合重试");
            }
            return { replayed: true };
          }
        }
        const job = await tx.generation_jobs.findFirst({
          where: { id: jid, project_id: pid, user_id: BigInt(userId), type: AUDIO_MIX_JOB_TYPE,
            source: AUDIO_MIX_SOURCE, is_delete: false },
          select: { id: true, status: true },
        });
        if (!job) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
        if (job.status !== "failed") throw new DomainError(409, "只有失败的音频混合任务可重试");
        const created = await tx.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: pid,
            type: AUDIO_MIX_JOB_TYPE,
            source: AUDIO_MIX_SOURCE,
            status: "queued",
            progress: 0,
            input: retryInput as Prisma.InputJsonValue,
            retry_of_job_id: jid,
            next_action_at: new Date(Date.now() - 60_000),
            execution_deadline_at: audioMixDeadline(retryEstimatedMs),
            fencing_token: 0,
          },
        });
        await billing?.charge(Number(created.id));
        await tx.command_idempotency.create({
          data: { ...key, request_hash: hash, generation_job_id: created.id, accepted_cursor: 0n },
        });
        if (plan) await writeCanvasRecoveryRows(tx, plan, created.id);
        return { replayed: false, jobId: created.id.toString() };
        }),
      );
      if (result.replayed) return this.withBindingView((await replay())!, projectId, canvasBinding);
      return this.withBindingView(
        ok({ job_id: result.jobId, status: "queued", replayed: false, enqueue_required: true }),
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

  async markFailed(userId: string, jobId: string, code: string, message: string): Promise<string> {
    await markFailedQueuedAndNotifyBilling({
      prisma: this.prisma.client,
      jobId,
      code,
      message,
      release: (id) => this.billing.release(userId, id, message),
    });
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
