import type {Prisma, PrismaClient} from "@prisma/client";

import {appendProjectEvent} from "./product-event-repo.js";
import {syncRecordSummary, syncStoryboardPreviewSummary} from "./generation-worker-internals.js";
import type {WorkerRepo} from "./generation-worker-types.js";

function fenceWhere(input: {jobId: string; workerId: string; fencingToken: number}) {
  return {
    id: BigInt(input.jobId),
    status: "processing" as const,
    lease_owner: input.workerId,
    fencing_token: BigInt(input.fencingToken),
  };
}

async function releaseReservationInTx(
  tx: Prisma.TransactionClient,
  jobId: string,
  releaseNote?: string,
): Promise<void> {
  await tx.cost_reservations.updateMany({
    where: { generation_job_id: BigInt(jobId), status: "reserved" },
    data: {
      status: "released",
      actual_amount_fen: 0n,
      ...(releaseNote ? { release_note: releaseNote } : {}),
    },
  });
}

async function settleReservationInTx(
  tx: Prisma.TransactionClient,
  jobId: string,
  actualAmountFen: bigint,
): Promise<void> {
  await tx.cost_reservations.updateMany({
    where: { generation_job_id: BigInt(jobId), status: "reserved" },
    data: { status: "settled", actual_amount_fen: actualAmountFen },
  });
}

async function completeJobInTx(
  tx: Prisma.TransactionClient,
  input: {
    jobId: string;
    assetIds: string[];
    workerId: string;
    fencingToken: number;
  },
): Promise<boolean> {
  const {jobId, assetIds, workerId, fencingToken} = input;
  const guarded = await tx.generation_jobs.updateMany({
    where: fenceWhere({jobId, workerId, fencingToken}),
    data: {
      status: "succeeded",
      progress: 100,
      output_asset_ids: assetIds.map((id) => Number(id)),
      next_action_at: null,
      lease_owner: null,
      lease_expires_at: null,
      version: {increment: 1},
    },
  });
  if (guarded.count !== 1) return false;
  const slots = await tx.generation_output_slots.findMany({
    where: { generation_job_id: BigInt(jobId) },
    orderBy: { slot_index: "asc" },
  });
  let finalStatus = "succeeded";
  if (slots.length > 0) {
    for (const [i, assetId] of assetIds.entries()) {
      const slot = slots[i];
      if (slot) {
        await tx.generation_output_slots.update({
          where: { id: slot.id },
          data: { status: "succeeded", asset_id: BigInt(assetId) },
        });
      }
    }
    for (let i = assetIds.length; i < slots.length; i += 1) {
      const slot = slots[i];
      if (!slot) continue;
      await tx.generation_output_slots.update({
        where: { id: slot.id },
        data: { status: "failed" },
      });
    }
    const statuses = slots.map((s, i) =>
      i < assetIds.length ? "succeeded" : "failed",
    );
    if (statuses.every((s) => s === "succeeded")) {
      finalStatus = "succeeded";
    } else if (statuses.some((s) => s === "succeeded")) {
      finalStatus = "partially_succeeded";
    } else {
      finalStatus = "failed";
    }
  }
  if (finalStatus !== "succeeded") {
    await tx.generation_jobs.update({
      where: { id: BigInt(jobId) },
      data: { status: finalStatus },
    });
  }
  const job = await tx.generation_jobs.findUnique({
    where: { id: BigInt(jobId) },
  });
  if (!job) {
    throw new Error(`completeJob 守卫通过后任务 ${jobId} 不存在，数据损坏`);
  }
  if (job.project_id === null) return true;
  await appendProjectEvent(tx, {
    projectId: job.project_id.toString(),
    eventType: "generation_job.status_changed",
    aggregateType: "generation_job",
    aggregateId: job.id.toString(),
    aggregateVersion: job.version,
    correlationId: `job_${job.id.toString()}`,
    payload: {
      job_id: job.id.toString(),
      type: job.type,
      source: job.source,
      status: job.status,
      progress: job.progress,
      output_asset_ids: assetIds,
    },
  });
  for (const [index, assetId] of assetIds.entries()) {
    const slot = slots[index];
    const slotIndex = slot?.slot_index ?? index;
    await appendProjectEvent(tx, {
      projectId: job.project_id.toString(),
      eventType: "generation_job.output_attached",
      aggregateType: "generation_job_output",
      aggregateId: `${job.id.toString()}:${slotIndex}`,
      aggregateVersion: 0,
      correlationId: `job_${job.id.toString()}`,
      payload: {
        job_id: job.id.toString(),
        slot_id: slot?.id.toString() ?? null,
        slot_index: slotIndex,
        status: "succeeded",
        asset_id: assetId,
        retry_of_slot_id:
          slot?.retry_of_slot_id == null
            ? null
            : slot.retry_of_slot_id.toString(),
        initial_placement_status: "pending",
      },
    });
  }
  for (let index = assetIds.length; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot) continue;
    await appendProjectEvent(tx, {
      projectId: job.project_id.toString(),
      eventType: "generation_job.output_updated",
      aggregateType: "generation_job_output",
      aggregateId: `${job.id.toString()}:${slot.slot_index}`,
      aggregateVersion: 0,
      correlationId: `job_${job.id.toString()}`,
      payload: {
        job_id: job.id.toString(),
        slot_id: slot.id.toString(),
        slot_index: slot.slot_index,
        status: "failed",
        asset_id: null,
        retry_of_slot_id:
          slot.retry_of_slot_id == null
            ? null
            : slot.retry_of_slot_id.toString(),
        initial_placement_status: "pending",
      },
    });
  }
  const firstSlot = slots[0];
  if (firstSlot?.scene_card_generation_record_id) {
    await syncRecordSummary(
      tx,
      firstSlot.scene_card_generation_record_id,
    );
  }
  await syncStoryboardPreviewSummary(tx, job.id);
  return true;
}

export function createWorkerSettleOps(prisma: PrismaClient): Pick<WorkerRepo, "completeJob" | "completeJobAndSettle" | "failJob" | "settleReservation" | "appendLog"> {
  return {
    async completeJob(input) {
      return prisma.$transaction(async (tx) => completeJobInTx(tx, input));
    },

    async completeJobAndSettle(input: {
      jobId: string;
      assetIds: string[];
      workerId: string;
      fencingToken: number;
      actualAmountFen?: bigint;
    }): Promise<boolean> {
      return prisma.$transaction(async (tx) => {
        const completed = await completeJobInTx(tx, input);
        if (!completed) return false;
        await settleReservationInTx(tx, input.jobId, input.actualAmountFen ?? 0n);
        return true;
      });
    },

    async failJob(input) {
      return prisma.$transaction(async (tx) => {
        const {jobId, errorCode, errorMessage, workerId, fencingToken} = input;
        const guarded = await tx.generation_jobs.updateMany({
          where: fenceWhere({jobId, workerId, fencingToken}),
          data: {
            status: "failed",
            error: {
              code: errorCode,
              message: errorMessage,
              ...(input.details !== undefined ? { details: input.details } : {}),
            } as never,
            next_action_at: null,
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (guarded.count !== 1) return false;
        const slots = await tx.generation_output_slots.findMany({
          where: { generation_job_id: BigInt(jobId), status: "pending" },
        });
        for (const slot of slots) {
          await tx.generation_output_slots.update({
            where: { id: slot.id },
            data: { status: "failed" },
          });
        }
        const job = await tx.generation_jobs.findUnique({
          where: { id: BigInt(jobId) },
        });
        if (!job) {
          throw new Error(`failJob 守卫通过后任务 ${jobId} 不存在，数据损坏`);
        }
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: job.id,
            event: "failed",
            status: "failed",
            message: `${errorCode}: ${errorMessage}`,
          },
        });
        if (job.project_id !== null) {
          await appendProjectEvent(tx, {
            projectId: job.project_id.toString(),
            eventType: "generation_job.status_changed",
            aggregateType: "generation_job",
            aggregateId: job.id.toString(),
            aggregateVersion: job.version,
            correlationId: `job_${job.id.toString()}`,
            payload: {
              job_id: job.id.toString(),
              type: job.type,
              source: job.source,
              status: job.status,
              progress: job.progress,
              error: { code: errorCode, message: errorMessage },
            },
          });
          for (const slot of slots) {
            await appendProjectEvent(tx, {
              projectId: job.project_id.toString(),
              eventType: "generation_job.output_updated",
              aggregateType: "generation_job_output",
              aggregateId: `${job.id.toString()}:${slot.slot_index}`,
              aggregateVersion: 0,
              correlationId: `job_${job.id.toString()}`,
              payload: {
                job_id: job.id.toString(),
                slot_id: slot.id.toString(),
                slot_index: slot.slot_index,
                status: "failed",
                asset_id: null,
                retry_of_slot_id:
                  slot.retry_of_slot_id == null
                    ? null
                    : slot.retry_of_slot_id.toString(),
                initial_placement_status: "pending",
                error: { code: errorCode, message: errorMessage },
              },
            });
          }
        }
        const firstSlot = slots[0];
        if (firstSlot?.scene_card_generation_record_id) {
          await syncRecordSummary(
            tx,
            firstSlot.scene_card_generation_record_id,
          );
        }
        await syncStoryboardPreviewSummary(tx, job.id);
        await releaseReservationInTx(tx, jobId, input.releaseNote);
        return true;
      });
    },

    async settleReservation(input) {
      return prisma.$transaction(async (tx) => {
        const owned = await tx.generation_jobs.updateMany({
          where: {
            id: BigInt(input.jobId),
            status: { in: ["succeeded", "partially_succeeded", "failed"] },
            fencing_token: BigInt(input.fencingToken),
          },
          data: { version: { increment: 1 } },
        });
        if (owned.count !== 1) return false;
        await tx.cost_reservations.updateMany({
          where: { generation_job_id: BigInt(input.jobId), status: "reserved" },
          data: {
            status: "settled",
            actual_amount_fen: input.actualAmountFen ?? 0n,
          },
        });
        return true;
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
