import type {PrismaClient} from "@prisma/client";

import {syncRecordSummary} from "./generation-worker-internals.js";
import type {WorkerRepo} from "./generation-worker-types.js";

const VIDEO_POLL_INTERVAL_MS = 5_000;

export function createWorkerVideoOps(prisma: PrismaClient): Pick<WorkerRepo, "markProviderSubmitted" | "rescheduleProviderPoll" | "publishVideoResult" | "failVideoJob" | "cancelVideoBeforeDispatch"> {
  return {
    async markProviderSubmitted(input) {
      const nextPollAt = new Date(Date.now() + VIDEO_POLL_INTERVAL_MS);
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
          next_action_at: nextPollAt,
          lease_owner: null,
          lease_expires_at: null,
          version: { increment: 1 },
        },
      });
      return updated.count === 1;
    },

    async rescheduleProviderPoll(input) {
      const nextPollAt = new Date(Date.now() + VIDEO_POLL_INTERVAL_MS);
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
            type: "video",
            url: input.url,
            storage_key: input.storageKey,
            mime: input.mime,
            size: input.size === null ? null : BigInt(input.size),
            width: input.width,
            height: input.height,
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
        await tx.billing_cost_reservations.updateMany({
          where: {
            generation_job_id: BigInt(input.jobId),
            status: "reserved",
          },
          data: {
            status: "settled",
            actual_amount_fen: input.actualAmountFen ?? 0n,
          },
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
        const videoSlot = await tx.generation_output_slots.findFirst({
          where: { generation_job_id: BigInt(input.jobId), slot_index: 0 },
        });
        if (videoSlot) {
          await tx.generation_output_slots.update({
            where: { id: videoSlot.id },
            data: { status: "succeeded", asset_id: asset.id },
          });
          if (videoSlot.scene_card_generation_record_id) {
            await syncRecordSummary(
              tx,
              videoSlot.scene_card_generation_record_id,
            );
          }
        }
        return true;
      });
    },

    async failVideoJob(input) {
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
        const pendingVideoSlots = await tx.generation_output_slots.findMany({
          where: { generation_job_id: BigInt(input.jobId), status: "pending" },
        });
        for (const slot of pendingVideoSlots) {
          await tx.generation_output_slots.update({
            where: { id: slot.id },
            data: { status: "failed" },
          });
          if (slot.scene_card_generation_record_id) {
            await syncRecordSummary(tx, slot.scene_card_generation_record_id);
          }
        }
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: BigInt(input.jobId),
            event: "failed",
            status: "failed",
            message: `${input.code}: ${input.message}`,
          },
        });
        await tx.billing_cost_reservations.updateMany({
          where: {
            generation_job_id: BigInt(input.jobId),
            status: "reserved",
          },
          data: {
            status: "released",
            actual_amount_fen: 0n,
            ...(input.releaseNote ? { release_note: input.releaseNote } : {}),
          },
        });
        return true;
      });
    },

    async cancelVideoBeforeDispatch(input) {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.generation_jobs.updateMany({
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
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return false;
        await tx.billing_cost_reservations.updateMany({
          where: {
            generation_job_id: BigInt(input.jobId),
            status: "reserved",
          },
          data: {
            status: "released",
            actual_amount_fen: 0n,
            release_note: "refund_confirmed",
          },
        });
        return true;
      });
    },
  };
}
