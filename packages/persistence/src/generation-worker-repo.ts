import type { PrismaClient } from "@prisma/client";

/** 生成 worker 的 DB port：轮询认领 queued 任务 + 调 provider 后落产出/状态/结算。
 *  简化模型：一次任务整体处理（产出多张图时全写 output_asset_ids 数组，不做多槽）。 */

export interface ClaimedJob {
  id: string;
  project_id: string;
  user_id: string;
  type: string;
  input: Record<string, unknown> | null;
  expected_output_count: number;
}

export interface ImageCapabilitySnapshot {
  model_id: string;
  api_size: string | null;
  width: number | null;
  height: number | null;
}

export interface WorkerInputAsset {
  id: string;
  type: string;
  url: string;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface ClaimedVideoJob {
  id: string;
  projectId: string;
  userId: string;
  input: Record<string, unknown>;
  providerTaskId: string | null;
  cancelRequested: boolean;
  workerId: string;
  fencingToken: number;
}

export interface WorkerRepo {
  /** 按任务和归属用户精确认领 queued 任务，供 request-scoped sk token 调度。 */
  claimJobById(
    jobId: string,
    userId: string,
    workerId: string,
  ): Promise<ClaimedJob | null>;
  /** 认领一个 queued 任务（next_action_at<=now），置 processing + lease。无则 null。 */
  claimNextJob(workerId: string): Promise<ClaimedJob | null>;
  /** 按 BullMQ 消息中的 DB jobId 领取一个待 submit/poll 的视频短步骤。 */
  claimVideoJobById(jobId: string, workerId: string): Promise<ClaimedVideoJob | null>;
  /** Redis 消息丢失或 Worker 重启后的低频补偿扫描。 */
  listDueVideoJobIds(limit: number): Promise<string[]>;
  /** 领取一个待 submit/poll 的视频短步骤；过期 processing 可被新 Worker 接管。 */
  claimNextVideoJob(workerId: string): Promise<ClaimedVideoJob | null>;
  /** submit 接纳后持久化上游 taskId，并释放租约等待下一次短 poll。 */
  markVideoSubmitted(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    providerTaskId: string;
  }): Promise<boolean>;
  rescheduleVideoPoll(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    progress: number;
  }): Promise<boolean>;
  publishVideoResult(input: {
    jobId: string;
    projectId: string;
    userId: string;
    workerId: string;
    fencingToken: number;
    url: string;
    storageKey: string | null;
    mime: string | null;
    size: number | null;
    width: number;
    height: number;
    duration: number;
  }): Promise<boolean>;
  failVideoJob(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    code: string;
    message: string;
  }): Promise<boolean>;
  cancelVideoBeforeDispatch(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
  }): Promise<boolean>;
  /** 按任务归属解析输入素材；返回顺序与 assetIds 一致。 */
  resolveInputAssets(
    assetIds: string[],
    userId: string,
    projectId: string,
  ): Promise<WorkerInputAsset[]>;
  /** 按 model_id 查启用能力，取 size 白名单里匹配 sizeId 的 api 值/宽高。 */
  findImageCapability(
    modelId: string,
    sizeId: string | null,
  ): Promise<ImageCapabilitySnapshot | null>;
  /** 建素材行（结果）。 */
  createAsset(input: {
    user_id: string;
    project_id: string;
    generation_job_id: string;
    url: string;
    type: string;
    width: number | null;
    height: number | null;
    storage_key: string | null;
    mime: string | null;
    size: number | null;
  }): Promise<string>;
  /** 任务成功：置 succeeded + output_asset_ids + progress=100 + 清 next_action_at。 */
  completeJob(jobId: string, assetIds: string[]): Promise<void>;
  /** 任务失败：置 failed + error + 记日志。 */
  failJob(
    jobId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
  /** 结算点数（reserved→settled，actual=0 占位，真计价后补）。 */
  settleReservation(jobId: string): Promise<void>;
  appendLog(
    jobId: string,
    event: string,
    status: string | null,
    message?: string,
    payload?: unknown,
  ): Promise<void>;
}

const LEASE_SECONDS = 120;

export function createWorkerRepo(prisma: PrismaClient): WorkerRepo {
  return {
    async claimJobById(jobId, userId, workerId) {
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          user_id: BigInt(userId),
          status: "queued",
          is_delete: false,
          source: "bottom_dock",
          next_action_at: { lte: new Date() },
        },
      });
      if (!candidate) return null;

      const now = new Date();
      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      const claimed = await prisma.generation_jobs
        .updateMany({
          where: {
            id: candidate.id,
            user_id: BigInt(userId),
            status: "queued",
          },
          data: {
            status: "processing",
            lease_owner: workerId,
            lease_expires_at: lease,
            last_polled_at: now,
            version: { increment: 1 },
          },
        })
        .catch(() => ({ count: 0 }));
      if (claimed.count === 0) return null;
      return {
        id: candidate.id.toString(),
        project_id: candidate.project_id?.toString() ?? "0",
        user_id: candidate.user_id.toString(),
        type: candidate.type,
        input: (candidate.input as Record<string, unknown> | null) ?? null,
        expected_output_count: candidate.expected_output_count ?? 1,
      };
    },

    async claimNextJob(workerId) {
      // 原子认领：查一条 queued 且到点的，CAS 置 processing。
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          status: "queued",
          is_delete: false,
          source: "bottom_dock",
          next_action_at: { lte: new Date() },
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;
      const now = new Date();
      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      // 乐观锁：仅当仍是 queued 才认领（version 自增），并发 worker 安全。
      const claimed = await prisma.generation_jobs
        .updateMany({
          where: { id: candidate.id, status: "queued" },
          data: {
            status: "processing",
            lease_owner: workerId,
            lease_expires_at: lease,
            last_polled_at: now,
            version: { increment: 1 },
          },
        })
        .catch(() => ({ count: 0 }));
      if (claimed.count === 0) return null;
      return {
        id: candidate.id.toString(),
        project_id: candidate.project_id?.toString() ?? "0",
        user_id: candidate.user_id.toString(),
        type: candidate.type,
        input: (candidate.input as Record<string, unknown> | null) ?? null,
        expected_output_count: candidate.expected_output_count ?? 1,
      };
    },

    async listDueVideoJobIds(limit) {
      const now = new Date();
      const rows = await prisma.generation_jobs.findMany({
        where: {
          type: "video",
          source: "bottom_dock",
          is_delete: false,
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
        take: Math.max(1, Math.min(500, limit)),
        select: { id: true },
      });
      return rows.map((row) => row.id.toString());
    },

    async claimVideoJobById(jobId, workerId) {
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          type: "video",
          source: "bottom_dock",
          is_delete: false,
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;

      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      const claimed = await prisma.generation_jobs.updateMany({
        where: {
          id: candidate.id,
          fencing_token: candidate.fencing_token,
          status: candidate.status,
        },
        data: {
          status: "processing",
          lease_owner: workerId,
          lease_expires_at: lease,
          last_polled_at: now,
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      return {
        id: candidate.id.toString(),
        projectId: candidate.project_id?.toString() ?? "0",
        userId: candidate.user_id.toString(),
        input:
          candidate.input && typeof candidate.input === "object" && !Array.isArray(candidate.input)
            ? (candidate.input as Record<string, unknown>)
            : {},
        providerTaskId: candidate.provider_task_id,
        cancelRequested: candidate.cancel_requested_at !== null,
        workerId,
        fencingToken: Number(candidate.fencing_token + 1n),
      };
    },

    async claimNextVideoJob(workerId) {
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          type: "video",
          source: "bottom_dock",
          is_delete: false,
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;

      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      const claimed = await prisma.generation_jobs.updateMany({
        where: {
          id: candidate.id,
          fencing_token: candidate.fencing_token,
          status: candidate.status,
        },
        data: {
          status: "processing",
          lease_owner: workerId,
          lease_expires_at: lease,
          last_polled_at: now,
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      return {
        id: candidate.id.toString(),
        projectId: candidate.project_id?.toString() ?? "0",
        userId: candidate.user_id.toString(),
        input:
          candidate.input && typeof candidate.input === "object" && !Array.isArray(candidate.input)
            ? (candidate.input as Record<string, unknown>)
            : {},
        providerTaskId: candidate.provider_task_id,
        cancelRequested: candidate.cancel_requested_at !== null,
        workerId,
        fencingToken: Number(candidate.fencing_token + 1n),
      };
    },

    async markVideoSubmitted(input) {
      const nextPollAt = new Date(Date.now() + 2_000);
      const updated = await prisma.generation_jobs.updateMany({
        where: {
          id: BigInt(input.jobId),
          status: "processing",
          lease_owner: input.workerId,
          fencing_token: BigInt(input.fencingToken),
        },
        data: {
          provider: "new-api",
          provider_task_id: input.providerTaskId,
          progress: 1,
          next_poll_at: nextPollAt,
          next_action_at: nextPollAt,
          lease_owner: null,
          lease_expires_at: null,
          version: { increment: 1 },
        },
      });
      return updated.count === 1;
    },

    async rescheduleVideoPoll(input) {
      const nextPollAt = new Date(Date.now() + 2_000);
      const updated = await prisma.generation_jobs.updateMany({
        where: {
          id: BigInt(input.jobId),
          status: "processing",
          lease_owner: input.workerId,
          fencing_token: BigInt(input.fencingToken),
        },
        data: {
          progress: Math.max(0, Math.min(99, Math.round(input.progress))),
          poll_count: { increment: 1 },
          next_poll_at: nextPollAt,
          next_action_at: nextPollAt,
          last_polled_at: new Date(),
          lease_owner: null,
          lease_expires_at: null,
          version: { increment: 1 },
        },
      });
      return updated.count === 1;
    },

    async publishVideoResult(input) {
      return prisma.$transaction(async (tx) => {
        const owned = await tx.generation_jobs.updateMany({
          where: {
            id: BigInt(input.jobId),
            status: "processing",
            lease_owner: input.workerId,
            fencing_token: BigInt(input.fencingToken),
          },
          data: {
            status: "succeeded",
            progress: 100,
            next_action_at: null,
            next_poll_at: null,
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (owned.count !== 1) return false;

        const asset = await tx.assets.create({
          data: {
            user_id: BigInt(input.userId),
            project_id: BigInt(input.projectId),
            generation_job_id: BigInt(input.jobId),
            type: "video",
            url: input.url,
            storage_key: input.storageKey,
            mime: input.mime,
            size: input.size === null ? null : BigInt(input.size),
            width: input.width,
            height: input.height,
            duration: input.duration,
            source: "generated",
            status: "normal",
          },
        });
        await tx.generation_jobs.update({
          where: { id: BigInt(input.jobId) },
          data: { output_asset_ids: [Number(asset.id)] },
        });
        await tx.cost_reservations.updateMany({
          where: {
            generation_job_id: BigInt(input.jobId),
            status: "reserved",
          },
          data: { status: "settled", actual_amount_fen: 0 },
        });
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: BigInt(input.jobId),
            event: "succeeded",
            status: "succeeded",
            message: "视频素材已发布",
            payload: { asset_ids: [asset.id.toString()] },
          } as never,
        });
        return true;
      });
    },

    async failVideoJob(input) {
      const updated = await prisma.generation_jobs.updateMany({
        where: {
          id: BigInt(input.jobId),
          status: "processing",
          lease_owner: input.workerId,
          fencing_token: BigInt(input.fencingToken),
        },
        data: {
          status: "failed",
          error: { code: input.code, message: input.message } as never,
          next_action_at: null,
          next_poll_at: null,
          lease_owner: null,
          lease_expires_at: null,
          version: { increment: 1 },
        },
      });
      if (updated.count === 1) {
        await this.appendLog(
          input.jobId,
          "failed",
          "failed",
          `${input.code}: ${input.message}`,
        );
      }
      return updated.count === 1;
    },

    async cancelVideoBeforeDispatch(input) {
      const updated = await prisma.generation_jobs.updateMany({
        where: {
          id: BigInt(input.jobId),
          status: "processing",
          provider_task_id: null,
          lease_owner: input.workerId,
          fencing_token: BigInt(input.fencingToken),
        },
        data: {
          status: "cancelled",
          progress: 0,
          next_action_at: null,
          next_poll_at: null,
          lease_owner: null,
          lease_expires_at: null,
          version: { increment: 1 },
        },
      });
      return updated.count === 1;
    },

    async resolveInputAssets(assetIds, userId, projectId) {
      if (assetIds.length === 0) return [];
      const rows = await prisma.assets.findMany({
        where: {
          id: { in: assetIds.map((id) => BigInt(id)) },
          user_id: BigInt(userId),
          OR: [{ project_id: BigInt(projectId) }, { project_id: BigInt(0) }],
          status: "normal",
          is_delete: false,
        },
        select: {
          id: true,
          type: true,
          url: true,
          mime: true,
          size: true,
          width: true,
          height: true,
          duration: true,
          duration_ms: true,
        },
      });
      const byId = new Map(rows.map((row) => [row.id.toString(), row]));
      return assetIds.flatMap((id) => {
        const row = byId.get(id);
        return row
          ? [{
              id,
              type: row.type,
              url: row.url,
              mime: row.mime,
              size: row.size === null ? null : Number(row.size),
              width: row.width,
              height: row.height,
              duration:
                row.duration_ms === null ? row.duration : row.duration_ms / 1000,
            }]
          : [];
      });
    },

    async findImageCapability(modelId, sizeId) {
      const cap = await prisma.generation_model_capability.findFirst({
        where: { model_id: modelId, enabled: true, is_delete: false },
      });
      if (!cap) return null;
      let apiSize: string | null = null;
      let width: number | null = null;
      let height: number | null = null;
      if (sizeId && Array.isArray(cap.supported_sizes)) {
        const match = (
          cap.supported_sizes as Array<Record<string, unknown>>
        ).find(
          (s) =>
            s?.id === sizeId ||
            s?.api_value === sizeId ||
            s?.apiValue === sizeId,
        );
        if (match) {
          apiSize =
            (match.api_value as string) ?? (match.apiValue as string) ?? null;
          width = (match.width as number) ?? null;
          height = (match.height as number) ?? null;
        }
      }
      return { model_id: cap.model_id, api_size: apiSize, width, height };
    },

    async createAsset(input) {
      const a = await prisma.assets.create({
        data: {
          user_id: BigInt(input.user_id),
          project_id: BigInt(input.project_id),
          generation_job_id: BigInt(input.generation_job_id),
          type: input.type,
          url: input.url,
          storage_key: input.storage_key,
          mime: input.mime,
          size: input.size == null ? null : BigInt(input.size),
          width: input.width,
          height: input.height,
          source: "generated",
          status: "normal",
        },
      });
      return a.id.toString();
    },

    async completeJob(jobId, assetIds) {
      await prisma.generation_jobs.update({
        where: { id: BigInt(jobId) },
        data: {
          status: "succeeded",
          progress: 100,
          output_asset_ids: assetIds.map((id) => Number(id)),
          next_action_at: null,
          lease_owner: null,
          lease_expires_at: null,
          version: { increment: 1 },
        },
      });
    },

    async failJob(jobId, errorCode, errorMessage) {
      await prisma.generation_jobs.update({
        where: { id: BigInt(jobId) },
        data: {
          status: "failed",
          error: { code: errorCode, message: errorMessage } as never,
          next_action_at: null,
          lease_owner: null,
          lease_expires_at: null,
          version: { increment: 1 },
        },
      });
      await this.appendLog(
        jobId,
        "failed",
        "failed",
        `${errorCode}: ${errorMessage}`,
      );
    },

    async settleReservation(jobId) {
      await prisma.cost_reservations.updateMany({
        where: { generation_job_id: BigInt(jobId), status: "reserved" },
        data: { status: "settled", actual_amount_fen: 0 },
      });
    },

    async appendLog(jobId, event, status, message, payload) {
      const data: Record<string, unknown> = {
        generation_job_id: BigInt(jobId),
        event,
        status,
      };
      if (message !== undefined) data.message = message;
      if (payload !== undefined) data.payload = payload as never;
      await prisma.generation_job_logs.create({ data: data as never });
    },
  };
}
