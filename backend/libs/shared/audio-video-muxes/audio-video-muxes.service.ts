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
  AUDIO_VIDEO_MUX_JOB_TYPE,
  AUDIO_VIDEO_MUX_SOURCE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  FAILURE_CODE,
  DomainError,
  audioVideoMuxCreateSchema,
  canvasBindingSchema,
  ok,
  recoveryError,
  type CanvasBinding,
  type RecoveryErrorEnvelope,
} from "@lib/contracts";

type FrozenMuxInput = { assetId: string; nodeId?: string; url: string };

@Injectable()
export class AudioVideoMuxesService {
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
    const parsed = audioVideoMuxCreateSchema.safeParse(body);
    if (!parsed.success) throw new DomainError(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音视频合成参数非法");
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
    ): Promise<{
      frozen: FrozenMuxInput;
      durationMs: number;
      width: number | null;
      height: number | null;
    }> => {
      const label = expectedType === "audio" ? "音频" : "视频";
      const asset = await this.assets.findOwnedSource(input.assetId, userId);
      if (!asset) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
      if (asset.project_id !== BigInt(projectId) && asset.project_id !== 0n && !linkedIds.has(input.assetId)) {
        throw new DomainError(RESOURCE_NOT_FOUND_CODE);
      }
      if (asset.type !== expectedType || !/^(https:\/\/|mediakit:\/\/|vod:\/\/|tos:\/\/)/i.test(asset.url)) {
        throw new DomainError(FAILURE_CODE, `${label}资产不可用`);
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
      const resolved = await resolveSourceDuration({
        prisma: this.prisma.client,
        storage: this.storage,
        probeDimensions: expectedType === "video",
        asset: {
          id: input.assetId,
          storage_key: storageKey,
          duration_ms: asset.duration_ms,
          width: asset.width,
          height: asset.height,
        },
      });
      if (resolved === null) {
        throw new DomainError(
          ASSET_UNAVAILABLE_CODE,
          `${label}时长读取失败，请稍后重试或更换素材`,
          503,
        );
      }
      return {
        frozen: {
          assetId: input.assetId,
          ...(input.nodeId ? { nodeId: input.nodeId } : {}),
          url: publicUrl,
        },
        durationMs: resolved.durationMs,
        width: resolved.width ?? asset.width,
        height: resolved.height ?? asset.height,
      };
    };

    let audioSlot: {
      frozen: FrozenMuxInput;
      durationMs: number;
      width: number | null;
      height: number | null;
    };
    let videoSlot: {
      frozen: FrozenMuxInput;
      durationMs: number;
      width: number | null;
      height: number | null;
    };
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
    const estimatedDurationMs = parsed.data.sync === "video"
      ? videoSlot.durationMs
      : parsed.data.sync === "audio"
        ? audioSlot.durationMs
        : Math.max(audioSlot.durationMs, videoSlot.durationMs);
    const durationSeconds = Math.max(1, Math.ceil(estimatedDurationMs / 1000));
    const longSide = Math.max(videoSlot.width ?? 0, videoSlot.height ?? 0);
    if (longSide <= 0) {
      throw new DomainError(
        ASSET_UNAVAILABLE_CODE,
        "视频分辨率读取失败，请稍后重试或更换素材",
        503,
      );
    }
    const resolution = longSide <= 1920 ? "1080p" : longSide <= 2560 ? "2k" : "4k";

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
        duration: durationSeconds,
        resolution,
        submit_attempt: 1,
      },
      next_action_at: new Date(Date.now() - 60_000),
      execution_deadline_at: audioVideoMuxDeadline(estimatedDurationMs),
    };
    const jobBilling = await this.billing.jobBilling(AUDIO_VIDEO_MUX_JOB_TYPE, userId, {
      duration: durationSeconds,
      resolution,
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
    let jobIdOfCreated = "";
    let replayed = false;
    try {
      const result = await withBillingCompensation(jobBilling, (billing) =>
        this.prisma.client.$transaction(async (tx) => {
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
        await billing?.charge(Number(created.id));
        await tx.command_idempotency.create({
          data: { ...key, request_hash: hash, generation_job_id: created.id, accepted_cursor: 0n },
        });
        if (plan) await writeCanvasRecoveryRows(tx, plan, created.id);
        return { replayed: false, jobId: created.id.toString() };
        }),
      );
      replayed = result.replayed;
      jobIdOfCreated = result.jobId ?? "";
    } catch (error) {
      if (error instanceof RecoveryContractError) return error.envelope;
      const existing = await replay();
      if (existing) return existing;
      throw error;
    }
    if (replayed) return this.withBindingView((await replay())!, projectId, canvasBinding);
    return this.withBindingView(
      ok({ job_id: jobIdOfCreated, status: "queued", replayed: false, enqueue_required: true }),
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
      where: { id: jid, project_id: pid, user_id: BigInt(userId), type: AUDIO_VIDEO_MUX_JOB_TYPE,
        source: AUDIO_VIDEO_MUX_SOURCE, is_delete: false },
      select: { id: true, status: true, input: true },
    });
    if (!owned) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
    const frozenOwned = owned.input as {
      duration?: unknown;
      estimated_duration_ms?: unknown;
      resolution?: unknown;
      submit_attempt?: unknown;
      video?: { assetId?: unknown };
    } | null;
    const retrySeconds = typeof frozenOwned?.duration === "number"
      ? frozenOwned.duration
      : typeof frozenOwned?.estimated_duration_ms === "number"
        ? Math.max(1, Math.ceil(frozenOwned.estimated_duration_ms / 1000))
        : null;
    let retryResolution = typeof frozenOwned?.resolution === "string" ? frozenOwned.resolution : null;
    if (retryResolution === null) {
      const videoAssetId = frozenOwned?.video?.assetId;
      const video = typeof videoAssetId === "string"
        ? await this.prisma.client.assets.findUnique({
            where: { id: BigInt(videoAssetId) },
            select: { width: true, height: true },
          })
        : null;
      if (video?.width && video.height) {
        const longSide = Math.max(video.width, video.height);
        retryResolution = longSide <= 1920 ? "1080p" : longSide <= 2560 ? "2k" : "4k";
      }
    }
    if (retrySeconds === null || retryResolution === null) {
      throw new DomainError(FAILURE_CODE, "任务缺少计费时长或分辨率，无法重试");
    }
    const retryEstimatedMs = typeof frozenOwned?.estimated_duration_ms === "number"
      ? frozenOwned.estimated_duration_ms
      : retrySeconds * 1000;
    const attempt = typeof frozenOwned?.submit_attempt === "number"
      && Number.isInteger(frozenOwned.submit_attempt)
      && frozenOwned.submit_attempt >= 1
      ? frozenOwned.submit_attempt
      : 1;
    const retryInput = {
      ...(frozenOwned ?? {}),
      duration: retrySeconds,
      resolution: retryResolution,
      submit_attempt: attempt + 1,
    };
    const retryBilling = await this.billing.jobBilling(AUDIO_VIDEO_MUX_JOB_TYPE, userId, {
      duration: retrySeconds,
      resolution: retryResolution,
    });
    const hash = createHash("sha256").update(
      `POST:audio_video_mux.retry:${projectId}:${jobId}${canvasBinding ? `:${JSON.stringify(canvasBinding)}` : ""}`,
    ).digest("hex");
    const key = { project_id: pid, operation: "audio_video_mux.retry", idempotency_key: idempotencyKey };
    const replay = async () => {
      const existing = await this.prisma.client.command_idempotency.findUnique({
        where: { project_id_operation_idempotency_key: key },
      });
      if (!existing) return null;
      if (existing.request_hash !== hash || !existing.generation_job_id) {
        throw new DomainError(409, "幂等键已用于另一项音视频合成重试");
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
            if (existing.request_hash !== hash || !existing.generation_job_id) {
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
        const living = await tx.assets.findMany({
          where: { id: { in: [BigInt(audioAssetId), BigInt(videoAssetId)] }, is_delete: false },
          select: { id: true },
        });
        if (living.length !== 2) throw new DomainError(409, "输入资产已删除，无法重试音视频合成");
        const created = await tx.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: pid,
            type: AUDIO_VIDEO_MUX_JOB_TYPE,
            source: AUDIO_VIDEO_MUX_SOURCE,
            status: "queued",
            progress: 0,
            input: retryInput as Prisma.InputJsonValue,
            retry_of_job_id: jid,
            next_action_at: new Date(Date.now() - 60_000),
            execution_deadline_at: audioVideoMuxDeadline(retryEstimatedMs),
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

function audioVideoMuxDeadline(estimatedDurationMs: number | null): Date {
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
