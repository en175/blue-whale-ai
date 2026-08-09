// IK74V8：从 generation-worker-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 作业结算：完成、失败、额度结算与作业日志追加。
import type {PrismaClient} from "@prisma/client";

import {appendProjectEvent} from "./product-event-repo.js";
import {syncRecordSummary, syncStoryboardPreviewSummary} from "./generation-worker-internals.js";
import type {WorkerRepo} from "./generation-worker-types.js";

export function createWorkerSettleOps(prisma: PrismaClient): Pick<WorkerRepo, "completeJob" | "failJob" | "settleReservation" | "appendLog"> {
  return {
    async completeJob(jobId, assetIds) {
      await prisma.$transaction(async (tx) => {
        // IK67HE/T14：同步输出槽状态——成功 asset 绑定对应 slot_index；缺失槽标 failed。
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
          // 未匹配到成功 asset 的剩余槽标 failed。
          for (let i = assetIds.length; i < slots.length; i += 1) {
            const slot = slots[i];
            if (!slot) continue;
            await tx.generation_output_slots.update({
              where: { id: slot.id },
              data: { status: "failed" },
            });
          }
          // 聚合 job 状态（全部成功→succeeded；部分→partially_succeeded；全失败→failed）。
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
        const job = await tx.generation_jobs.update({
          where: { id: BigInt(jobId) },
          data: {
            status: finalStatus,
            progress: 100,
            output_asset_ids: assetIds.map((id) => Number(id)),
            next_action_at: null,
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (job.project_id === null) return;
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
        // 回写关联的 SceneCardGenerationRecord.summary_status（视频路径）。
        const firstSlot = slots[0];
        if (firstSlot?.scene_card_generation_record_id) {
          await syncRecordSummary(
            tx,
            firstSlot.scene_card_generation_record_id,
          );
        }
        // 回写 StoryboardPreview.summary_status（图片路径，IK67HF/T15）。
        await syncStoryboardPreviewSummary(tx, job.id);
      });
    },

    async failJob(jobId, errorCode, errorMessage) {
      await prisma.$transaction(async (tx) => {
        // IK67HE/T14：失败时把该 job 的全部 pending 槽标 failed。
        const slots = await tx.generation_output_slots.findMany({
          where: { generation_job_id: BigInt(jobId), status: "pending" },
        });
        for (const slot of slots) {
          await tx.generation_output_slots.update({
            where: { id: slot.id },
            data: { status: "failed" },
          });
        }
        const job = await tx.generation_jobs.update({
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
        // 回写关联的 SceneCardGenerationRecord.summary_status（视频路径）。
        const firstSlot = slots[0];
        if (firstSlot?.scene_card_generation_record_id) {
          await syncRecordSummary(
            tx,
            firstSlot.scene_card_generation_record_id,
          );
        }
        // 回写 StoryboardPreview.summary_status（图片路径，IK67HF/T15）。
        await syncStoryboardPreviewSummary(tx, job.id);
      });
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
