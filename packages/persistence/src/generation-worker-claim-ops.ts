// IK74V8：从 generation-worker-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 任务领取与重排：图片/视频作业的 CAS 领取、租约回收、重试重排。
import type {PrismaClient} from "@prisma/client";

import {CLAIMABLE_JOB_SOURCES, imageJobLeaseSeconds} from "./generation-worker-internals.js";
import type {WorkerRepo} from "./generation-worker-types.js";

export function createWorkerClaimOps(prisma: PrismaClient): Pick<WorkerRepo, "claimJobById" | "claimNextJob" | "listDueVideoJobIds" | "claimVideoJobById" | "resetStalledImageJobs" | "claimNextImageJob" | "requeueImageJobForRetry" | "claimNextVideoJob"> {
  // 与拆分前一致：每次创建仓储时读一次 IMAGE_JOB_LEASE_SECONDS。
  const LEASE_SECONDS = imageJobLeaseSeconds();
  return {
    async claimJobById(jobId, userId, workerId) {
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          user_id: BigInt(userId),
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
      });
      if (!candidate) return null;

      const now = new Date();
      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      // IK7GRO：CAS 条件含当前 fencing_token，领取成功时递增并发给 worker（与视频 claim 同构）。
      const claimed = await prisma.generation_jobs
        .updateMany({
          where: {
            id: candidate.id,
            user_id: BigInt(userId),
            status: "queued",
            fencing_token: candidate.fencing_token,
          },
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
    },

    async claimNextJob(workerId) {
      // 原子认领：查一条 queued 且到点的，CAS 置 processing。
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;
      const now = new Date();
      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      // IK7GRO：乐观锁加入 fencing_token 约束，领取时递增并发给 worker（与视频 claim 同构）。
      const claimed = await prisma.generation_jobs
        .updateMany({
          where: { id: candidate.id, status: "queued", fencing_token: candidate.fencing_token },
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
      };
    },

    async resetStalledImageJobs() {
      const now = new Date();
      // IK7GRO：过期重放时递增 fencing_token，使上一次领取发放的旧 token 立即失效。
      const result = await prisma.generation_jobs
        .updateMany({
          where: {
            type: "image",
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
      // 原子认领：查一条到点的图片 queued，CAS 置 processing。镜像视频的 claimNextJob，仅限 type=image。
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          type: "image",
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;
      const now = new Date();
      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      // IK7GRO：CAS 条件含当前 fencing_token，领取成功时递增并发给 worker（与视频 claim 同构）。
      const claimed = await prisma.generation_jobs
        .updateMany({
          where: { id: candidate.id, status: "queued", fencing_token: candidate.fencing_token },
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
      };
    },
  };
}
