// IK74V8：从 generation-worker-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 任务领取与重排：图片/视频作业的 CAS 领取、租约回收、重试重排。
import type {PrismaClient} from "@prisma/client";

import {CLAIMABLE_JOB_SOURCES, imageJobLeaseSeconds} from "./generation-worker-internals.js";
import type {WorkerRepo} from "./generation-worker-types.js";

/** IK9VZ0：视频实扣二次校验用——读 job 当前预留金额（fen）。查询失败/无预留 → null，不阻塞认领。 */
async function loadReservationFen(
  prisma: PrismaClient,
  jobId: bigint,
): Promise<bigint | null> {
  try {
    const row = await prisma.cost_reservations.findFirst({
      where: { generation_job_id: jobId, is_delete: 0 },
      select: { reserved_amount_fen: true },
    });
    return row ? row.reserved_amount_fen : null;
  } catch {
    return null;
  }
}

export function createWorkerClaimOps(prisma: PrismaClient): Pick<WorkerRepo, "claimJobById" | "claimNextJob" | "listDueVideoJobIds" | "claimVideoJobById" | "claimMediaExtractJobById" | "resetStalledImageJobs" | "claimNextImageJob" | "claimNextInProcessJob" | "requeueImageJobForRetry" | "claimNextVideoJob"> {
  // 与拆分前一致：每次创建仓储时读一次 IMAGE_JOB_LEASE_SECONDS。
  const LEASE_SECONDS = imageJobLeaseSeconds();

  // IK7GRQ：图片 claim 三族合一。queued 任务的领取语义（候选查询 → CAS 条件含 fencing_token
  // → 置 processing + 租约 + 递增 fencing_token/version → 返回 ClaimedJob）单点实现于此，
  // claimJobById / claimNextJob / claimNextImageJob 仅以候选查询条件差异化调用。纯重构，行为不变。
  async function claimQueuedJob(
    workerId: string,
    candidateWhere: Record<string, unknown>,
    options?: { orderBy?: Record<string, unknown>; casUserId?: string },
  ) {
    const findFirstArgs: { where: Record<string, unknown>; orderBy?: Record<string, unknown> } = {
      where: candidateWhere,
    };
    if (options?.orderBy) {
      findFirstArgs.orderBy = options.orderBy;
    }
    const candidate = await prisma.generation_jobs.findFirst(findFirstArgs);
    if (!candidate) return null;

    const now = new Date();
    const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
    // CAS 条件：命中候选 id + queued + 读到的 fencing_token（+byId 再锁 user_id）。领取成功递增并发给 worker。
    const casWhere: Record<string, unknown> = {
      id: candidate.id,
      status: "queued",
      fencing_token: candidate.fencing_token,
    };
    if (options?.casUserId !== undefined) {
      casWhere.user_id = BigInt(options.casUserId);
    }
    const claimed = await prisma.generation_jobs
      .updateMany({
        where: casWhere,
        data: {
          status: "processing",
          lease_owner: workerId,
          lease_expires_at: lease,
          last_polled_at: now,
          fencing_token: { increment: 1 },
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
      retry_count: candidate.retry_count ?? 0,
      fencingToken: Number(candidate.fencing_token + 1n),
    };
  }

  return {
    async claimJobById(jobId, userId, workerId) {
      // IK7GRQ：薄封装——byId + userId 精确领取，候选查询锁 id/user_id，CAS 再锁 user_id。
      return claimQueuedJob(
        workerId,
        {
          id: BigInt(jobId),
          user_id: BigInt(userId),
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        { casUserId: userId },
      );
    },

    async claimNextJob(workerId) {
      // IK7GRQ：薄封装——认领一条 queued 且到点的（不限 type），按 id asc。
      return claimQueuedJob(
        workerId,
        {
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        { orderBy: { id: "asc" } },
      );
    },

    async listDueVideoJobIds(limit) {
      const now = new Date();
      const rows = await prisma.generation_jobs.findMany({
        where: {
          type: "video",
          source: { in: ["bottom_dock", "plan_apply", "plan", "scene_card"] },
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
          source: { in: ["bottom_dock", "plan_apply", "plan", "scene_card"] },
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
          candidate.input &&
          typeof candidate.input === "object" &&
          !Array.isArray(candidate.input)
            ? (candidate.input as Record<string, unknown>)
            : {},
        providerTaskId: candidate.provider_task_id,
        cancelRequested: candidate.cancel_requested_at !== null,
        workerId,
        fencingToken: Number(candidate.fencing_token + 1n),
        // IK9VZ0：视频实扣二次校验的基准（预留金额，fen；无预留/查询失败为 null）。
        reservedAmountFen: await loadReservationFen(prisma, candidate.id),
      };
    },

    async claimMediaExtractJobById(jobId, workerId) {
      // IKARDY：媒体提取短步骤，镜像 claimVideoJobById 的 CAS 领取；type=media_extract 不限 source。
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          type: "media_extract",
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
          candidate.input &&
          typeof candidate.input === "object" &&
          !Array.isArray(candidate.input)
            ? (candidate.input as Record<string, unknown>)
            : {},
        workerId,
        fencingToken: Number(candidate.fencing_token + 1n),
      };
    },

    async resetStalledImageJobs() {
      const now = new Date();
      // IK7GRO：过期重放时递增 fencing_token，使上一次领取发放的旧 token 立即失效。
      // IK9ILQ：进程内任务(image+audio)统一重放,音频任务不进视频队列。
      const result = await prisma.generation_jobs
        .updateMany({
          where: {
            type: { in: ["image", "audio"] },
            status: "processing",
            is_delete: false,
            lease_expires_at: { lt: now },
          },
          data: {
            status: "queued",
            lease_owner: null,
            lease_expires_at: null,
            next_action_at: now,
            fencing_token: { increment: 1 },
            version: { increment: 1 },
          },
        })
        .catch(() => ({ count: 0 }));
      return result.count;
    },

    async claimNextImageJob(workerId) {
      // IK7GRQ：薄封装——认领一条到点的图片 queued，仅限 type=image，按 id asc。
      return claimQueuedJob(
        workerId,
        {
          type: "image",
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        { orderBy: { id: "asc" } },
      );
    },

    async claimNextInProcessJob(workerId) {
      // IK9ILQ：薄封装——认领一条到点的进程内任务(image 或 audio),仅限 type∈(image,audio)，
      // 按 id asc；视频走独立 RocketMQ worker，不在此认领。
      return claimQueuedJob(
        workerId,
        {
          type: { in: ["image", "audio"] },
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        { orderBy: { id: "asc" } },
      );
    },

    async requeueImageJobForRetry(jobId, nextActionAt) {
      // 瞬时失败重试：仅当前 processing 态可回退到 queued，避免覆盖终态/他人态。
      // IK7GRO：重排时递增 fencing_token，使上一次领取发放的旧 token 立即失效。
      const result = await prisma.generation_jobs
        .updateMany({
          where: { id: BigInt(jobId), status: "processing" },
          data: {
            status: "queued",
            lease_owner: null,
            lease_expires_at: null,
            next_action_at: nextActionAt,
            retry_count: { increment: 1 },
            fencing_token: { increment: 1 },
            version: { increment: 1 },
          },
        })
        .catch(() => ({ count: 0 }));
      return result.count > 0;
    },

    async claimNextVideoJob(workerId) {
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          type: "video",
          source: { in: ["bottom_dock", "plan_apply", "plan", "scene_card"] },
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
          candidate.input &&
          typeof candidate.input === "object" &&
          !Array.isArray(candidate.input)
            ? (candidate.input as Record<string, unknown>)
            : {},
        providerTaskId: candidate.provider_task_id,
        cancelRequested: candidate.cancel_requested_at !== null,
        workerId,
        fencingToken: Number(candidate.fencing_token + 1n),
        // IK9VZ0：视频实扣二次校验的基准（预留金额，fen；无预留/查询失败为 null）。
        reservedAmountFen: await loadReservationFen(prisma, candidate.id),
      };
    },
  };
}
