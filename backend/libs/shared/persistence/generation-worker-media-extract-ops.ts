import type { PrismaClient } from "@prisma/client";

import { imageJobLeaseSeconds } from "./generation-worker-internals.js";
import type { WorkerRepo } from "./generation-worker-types.js";

export function createWorkerMediaExtractOps(
  prisma: PrismaClient,
): Pick<
  WorkerRepo,
  | "updateMediaExtractProgress"
  | "publishMediaExtractResult"
  | "failMediaExtractJob"
> {
  const LEASE_SECONDS = imageJobLeaseSeconds();
  return {
    async updateMediaExtractProgress(input) {
      const updated = await prisma.generation_jobs.updateMany({
        where: {
          id: BigInt(input.jobId),
          status: "processing",
          lease_owner: input.workerId,
          fencing_token: BigInt(input.fencingToken),
        },
        data: {
          progress: Math.max(0, Math.min(99, Math.round(input.progress))),
          last_polled_at: new Date(),
          lease_expires_at: new Date(Date.now() + LEASE_SECONDS * 1000),
          version: { increment: 1 },
        },
      });
      return updated.count === 1;
    },

    async publishMediaExtractResult(input) {
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
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (owned.count !== 1) return false;

        const asset = await tx.user_assets.create({
          data: {
            user_id: BigInt(input.userId),
            project_id: BigInt(input.projectId),
            generation_job_id: BigInt(input.jobId),
            type: "audio",
            url: input.url,
            storage_key: input.storageKey,
            mime: input.mime,
            size: BigInt(input.size),
            duration_ms:
              input.duration === null || input.duration === undefined
                ? null
                : Math.round(input.duration * 1000),
            source: "generated",
            status: "normal",
          },
        });
        await tx.generation_jobs.update({
          where: { id: BigInt(input.jobId) },
          data: { output_asset_ids: [Number(asset.id)] },
        });
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: BigInt(input.jobId),
            event: "succeeded",
            status: "succeeded",
            message: "音频已提取",
            payload: { asset_ids: [asset.id.toString()] },
          } as never,
        });

        return true;
      });
    },

    async failMediaExtractJob(input) {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.generation_jobs.updateMany({
          where: {
            id: BigInt(input.jobId),
            status: "processing",
            lease_owner: input.workerId,
            fencing_token: BigInt(input.fencingToken),
          },
          data: {
            status: "failed",
            error: {
              code: input.code,
              message: input.message,
              ...(input.details !== undefined ? { details: input.details } : {}),
            } as never,
            next_action_at: null,
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return false;
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: BigInt(input.jobId),
            event: "failed",
            status: "failed",
            message: `${input.code}: ${input.message}`,
          },
        });
        return true;
      });
    },
  };
}
