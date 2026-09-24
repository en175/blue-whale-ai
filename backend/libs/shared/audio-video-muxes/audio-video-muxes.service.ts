import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { loadTosStorageConfig } from "@lib/shared/assets/tos-storage.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import {
  AUDIO_VIDEO_MUX_JOB_TYPE,
  AUDIO_VIDEO_MUX_SOURCE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  FAILURE_CODE,
  ERROR_ENQUEUE_FAILED,
  DomainError,
  audioVideoMuxCreateSchema,
  ok,
} from "@lib/contracts";

/** 冻结快照里的单输入（对象内 camel 命名 + 服务端解析 URL；迁移契约 §20.2）。 */
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
   *  权威复核两份资产归属/媒体类型/URL 协议白名单/公开可读后冻结输入快照；拒绝时不留任务。 */
  async create(
    userId: string,
    projectId: string,
    body: unknown,
    internal: { providerCredential?: string } = {},
  ) {
    const parsed = audioVideoMuxCreateSchema.safeParse(body);
    if (!parsed.success) throw new DomainError(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音视频合成参数非法");

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
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
      // 协议白名单与迁移契约 §20.1 冻结一致（https/mediakit/vod/tos，不含 http）：http URL
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

    const job = await this.prisma.client.generation_jobs.create({
      data: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: AUDIO_VIDEO_MUX_JOB_TYPE,
        source: AUDIO_VIDEO_MUX_SOURCE,
        status: "queued",
        progress: 0,
        expected_output_count: 1,
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
      },
    });
    return ok({ job_id: job.id.toString(), status: "queued", enqueue_required: true });
  }

  /** 重试入口（IKIHPL）：读冻结快照重放，不读画布当前选中态、不重新解析资产 URL；
   *  快照缺失或输入资产已删除时给出明确拒绝原因。仅 failed 态可重试，其他状态拒绝。
   *  幂等双轨：Idempotency-Key + command_idempotency 表（operation audio_video_mux.retry），
   *  同事务 CAS failed→queued；免费任务同创建：无积分冻结、无成本预留、无余额拦截。 */
  async retry(userId: string, projectId: string, jobId: string, idempotencyKey: string) {
    if (!/^[!-~]{1,128}$/.test(idempotencyKey)) {
      throw new DomainError(PARAM_MISSING_CODE, "Idempotency-Key 必须为 1–128 个可打印非空白字符");
    }
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
    const hash = createHash("sha256").update(`POST:audio_video_mux.retry:${projectId}:${jobId}`).digest("hex");
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
        const existing = await tx.command_idempotency.findUnique({
          where: { project_id_operation_idempotency_key: key },
        });
        if (existing) {
          if (existing.request_hash !== hash || existing.generation_job_id !== jid) {
            throw new DomainError(409, "幂等键已用于另一项音视频合成重试");
          }
          return { replayed: true };
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
            provider_task_id: null, poll_count: 0, next_poll_at: null,
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
        return { replayed: false };
      });
      if (result.replayed) return (await replay())!;
      return ok({ job_id: jobId, status: "queued", replayed: false, enqueue_required: true });
    } catch (error) {
      if (error instanceof DomainError && error.status !== 409) throw error;
      const existing = await replay();
      if (existing) return existing;
      throw error;
    }
  }

  async markFailed(jobId: string, code: string, message: string): Promise<string> {
    await createGenerationCommandRepo(this.prisma.client).markFailedQueued(jobId, code, message);
    const current = await this.prisma.client.generation_jobs.findUniqueOrThrow({
      where: { id: BigInt(jobId) }, select: { status: true },
    });
    return current.status;
  }
}

/** 超时预算（迁移契约 §20.1）：max(1d, 4×估算+6h)、未知 7d、上限 365d。 */
function audioVideoMuxDeadline(estimatedDurationMs: number | null): Date {
  const day = 24 * 60 * 60 * 1000;
  const budget = estimatedDurationMs !== null && Number.isFinite(estimatedDurationMs) && estimatedDurationMs > 0
    ? Math.max(day, estimatedDurationMs * 4 + 6 * 60 * 60 * 1000)
    : 7 * day;
  return new Date(Date.now() + Math.min(budget, 365 * day));
}
