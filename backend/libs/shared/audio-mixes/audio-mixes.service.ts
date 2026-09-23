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
  AUDIO_MIX_JOB_TYPE,
  AUDIO_MIX_SOURCE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  FAILURE_CODE,
  ERROR_ENQUEUE_FAILED,
  DomainError,
  audioMixCreateSchema,
  ok,
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
    internal: { providerCredential?: string } = {},
  ) {
    const parsed = audioMixCreateSchema.safeParse(body);
    if (!parsed.success) throw new DomainError(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音频混合参数非法");

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) throw new DomainError(RESOURCE_NOT_FOUND_CODE);

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

    const job = await this.prisma.client.generation_jobs.create({
      data: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: AUDIO_MIX_JOB_TYPE,
        source: AUDIO_MIX_SOURCE,
        status: "queued",
        progress: 0,
        expected_output_count: 1,
        input: {
          source_node_id: parsed.data.source_node_id,
          inputs: frozenInputs,
          output_format: parsed.data.output_format,
          estimated_duration_ms: estimatedDurationMs,
          ...(internal.providerCredential ? { provider_credential: internal.providerCredential } : {}),
        },
        next_action_at: new Date(Date.now() - 60_000),
        execution_deadline_at: audioMixDeadline(estimatedDurationMs),
      },
    });
    return ok({ job_id: job.id.toString(), status: "queued" });
  }

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
      where: { id: jid, project_id: pid, user_id: BigInt(userId), type: AUDIO_MIX_JOB_TYPE,
        source: AUDIO_MIX_SOURCE, is_delete: false },
      select: { id: true },
    });
    if (!owned) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
    const hash = createHash("sha256").update(`POST:audio_mix.retry:${projectId}:${jobId}`).digest("hex");
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
        const existing = await tx.command_idempotency.findUnique({
          where: { project_id_operation_idempotency_key: key },
        });
        if (existing) {
          if (existing.request_hash !== hash || existing.generation_job_id !== jid) {
            throw new DomainError(409, "幂等键已用于另一项音频混合重试");
          }
          return { replayed: true };
        }
        const job = await tx.generation_jobs.findFirst({
          where: { id: jid, project_id: pid, user_id: BigInt(userId), type: AUDIO_MIX_JOB_TYPE,
            source: AUDIO_MIX_SOURCE, is_delete: false },
        });
        if (!job) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
        if (job.status !== "failed") throw new DomainError(409, "只有失败的音频混合任务可重试");
        const frozen = job.input as { estimated_duration_ms?: unknown } | null;
        const duration = typeof frozen?.estimated_duration_ms === "number" ? frozen.estimated_duration_ms : null;
        const updated = await tx.generation_jobs.updateMany({
          where: { id: jid, status: "failed", fencing_token: job.fencing_token },
          data: {
            status: "queued", progress: 0, error: Prisma.DbNull, output_asset_ids: Prisma.DbNull,
            provider_task_id: null, poll_count: 0, next_poll_at: null,
            next_action_at: new Date(Date.now() - 60_000),
            execution_deadline_at: audioMixDeadline(duration),
            lease_owner: null, lease_expires_at: null,
            fencing_token: { increment: 1 }, retry_count: { increment: 1 }, version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new DomainError(409, "音频混合任务正在重试");
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

function audioMixDeadline(estimatedDurationMs: number | null): Date {
  const day = 24 * 60 * 60 * 1000;
  const budget = estimatedDurationMs !== null && Number.isFinite(estimatedDurationMs) && estimatedDurationMs > 0
    ? Math.max(day, estimatedDurationMs * 4 + 6 * 60 * 60 * 1000)
    : 7 * day;
  return new Date(Date.now() + Math.min(budget, 365 * day));
}
