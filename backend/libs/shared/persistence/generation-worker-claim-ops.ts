import type {PrismaClient} from "@prisma/client";

import {CLAIMABLE_JOB_SOURCES, imageJobLeaseSeconds} from "./generation-worker-internals.js";
import type {WorkerRepo} from "./generation-worker-types.js";

const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function loadReservationFen(
  prisma: PrismaClient,
  jobId: bigint,
): Promise<bigint | null> {
  try {
    const row = await prisma.billing_cost_reservations.findFirst({
      where: { generation_job_id: jobId, is_delete: 0 },
      select: { reserved_amount_fen: true },
    });
    return row ? row.reserved_amount_fen : null;
  } catch {
    return null;
  }
}

export function createWorkerClaimOps(prisma: PrismaClient): Pick<
  WorkerRepo,
  | "claimJobById"
  | "claimNextJob"
  | "listDueVideoJobIds"
  | "listDueImageJobIds"
  | "listDueMediaExtractJobIds"
  | "listDueAudioJobIds"
  | "claimVideoJobById"
  | "claimImageJobById"
  | "claimAudioJobById"
  | "claimMediaExtractJobById"
  | "resetStalledImageJobs"
  | "claimNextImageJob"
  | "claimNextInProcessJob"
  | "requeueImageJobForRetry"
  | "claimNextVideoJob"
> {
  const LEASE_SECONDS = imageJobLeaseSeconds();

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
      retry_count: candidate.retry_count ?? 0,
      cancelRequested: candidate.cancel_requested_at != null,
      fencingToken: Number(candidate.fencing_token + 1n),
    };
  }

  return {
    async claimJobById(jobId, userId, workerId) {
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
          gmt_create: { gt: new Date(now.getTime() - RECOVERY_MAX_AGE_MS) },
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

    async listDueImageJobIds(limit) {
      const now = new Date();
      const rows = await prisma.generation_jobs.findMany({
        where: {
          type: "image",
          source: { in: CLAIMABLE_JOB_SOURCES },
          is_delete: false,
          gmt_create: { gt: new Date(now.getTime() - RECOVERY_MAX_AGE_MS) },
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

    async listDueMediaExtractJobIds(limit) {
      const now = new Date();
      const rows = await prisma.generation_jobs.findMany({
        where: {
          type: "media_extract",
          is_delete: false,
          gmt_create: { gt: new Date(now.getTime() - RECOVERY_MAX_AGE_MS) },
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

    async listDueAudioJobIds(limit) {
      const now = new Date();
      const rows = await prisma.generation_jobs.findMany({
        where: {
          type: "audio",
          is_delete: false,
          gmt_create: { gt: new Date(now.getTime() - RECOVERY_MAX_AGE_MS) },
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
        pollCount: Number(candidate.poll_count ?? 0),
        progress: Number(candidate.progress ?? 0),
        parentProviderTaskId: candidate.retry_of_job_id
          ? await loadParentProviderTaskId(
              prisma,
              candidate.retry_of_job_id,
              candidate.user_id,
              candidate.project_id,
            )
          : null,
        reservedAmountFen: await loadReservationFen(prisma, candidate.id),
      };
    },

    async claimImageJobById(jobId, workerId) {
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          type: "image",
          source: { in: CLAIMABLE_JOB_SOURCES },
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
        project_id: candidate.project_id?.toString() ?? "0",
        user_id: candidate.user_id.toString(),
        type: candidate.type,
        input: (candidate.input as Record<string, unknown> | null) ?? null,
        retry_count: candidate.retry_count ?? 0,
        cancelRequested: candidate.cancel_requested_at != null,
        fencingToken: Number(candidate.fencing_token + 1n),
      };
    },

    async claimAudioJobById(jobId, workerId) {
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          type: "audio",
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
        project_id: candidate.project_id?.toString() ?? "0",
        user_id: candidate.user_id.toString(),
        type: candidate.type,
        input: (candidate.input as Record<string, unknown> | null) ?? null,
        retry_count: candidate.retry_count ?? 0,
        cancelRequested: candidate.cancel_requested_at != null,
        fencingToken: Number(candidate.fencing_token + 1n),
      };
    },

    async claimMediaExtractJobById(jobId, workerId) {
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
      return claimQueuedJob(
        workerId,
        {
          type: "audio",
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        { orderBy: { id: "asc" } },
      );
    },

    async requeueImageJobForRetry(jobId, nextActionAt) {
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
        pollCount: Number(candidate.poll_count ?? 0),
        progress: Number(candidate.progress ?? 0),
        parentProviderTaskId: candidate.retry_of_job_id
          ? await loadParentProviderTaskId(
              prisma,
              candidate.retry_of_job_id,
              candidate.user_id,
              candidate.project_id,
            )
          : null,
        reservedAmountFen: await loadReservationFen(prisma, candidate.id),
      };
    },
  };
}

async function loadParentProviderTaskId(
  prisma: PrismaClient,
  parentJobId: bigint,
  userId: bigint,
  projectId: bigint | null,
): Promise<string | null> {
  const parent = await prisma.generation_jobs.findFirst({
    where: { id: parentJobId, user_id: userId, project_id: projectId },
    select: { provider_task_id: true },
  });
  return parent?.provider_task_id ?? null;
}
