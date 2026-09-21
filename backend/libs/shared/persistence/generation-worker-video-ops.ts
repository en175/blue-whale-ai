// IK74V8：从 generation-worker-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 视频作业生命周期：提交、轮询重排、结果发布、失败与派发前取消。
import type {PrismaClient} from "@prisma/client";

import {appendProjectEvent} from "./product-event-repo.js";
import {syncRecordSummary} from "./generation-worker-internals.js";
import type {WorkerRepo} from "./generation-worker-types.js";

/** IKBBXH：视频轮询内循环步调（ms）。须与 generation-runtime 的 VIDEO_POLL_INTERVAL_MS 保持一致。 */
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
          next_poll_at: nextPollAt,
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
        await tx.cost_reservations.updateMany({
          where: {
            generation_job_id: BigInt(input.jobId),
            status: "reserved",
          },
          data: {
            status: "settled",
            // IK7G9X：视频实扣金额由 worker 从 new-api 任务查询 quota 换算后传入；缺省 0（旧行为）。
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
        const job = await tx.generation_jobs.findUnique({
          where: { id: BigInt(input.jobId) },
        });
        // IK67HE/T14：视频产物产出时更新输出槽（slot_index 0 succeeded）+ 回写 record summary。
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
        if (job?.project_id !== null && job?.project_id !== undefined) {
          await appendProjectEvent(tx, {
            projectId: job.project_id.toString(),
            eventType: "asset.created",
            aggregateType: "asset",
            aggregateId: asset.id.toString(),
            aggregateVersion: asset.version,
            correlationId: `job_${job.id.toString()}`,
            payload: {
              asset_id: asset.id.toString(),
              generation_job_id: job.id.toString(),
              type: asset.type,
              access_url: asset.url,
            },
          });
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
              output_asset_ids: [asset.id.toString()],
            },
          });
          await appendProjectEvent(tx, {
            projectId: job.project_id.toString(),
            eventType: "generation_job.output_attached",
            aggregateType: "generation_job_output",
            aggregateId: `${job.id.toString()}:${videoSlot?.slot_index ?? 0}`,
            aggregateVersion: 0,
            correlationId: `job_${job.id.toString()}`,
            payload: {
              job_id: job.id.toString(),
              slot_id: videoSlot?.id.toString() ?? null,
              slot_index: videoSlot?.slot_index ?? 0,
              status: "succeeded",
              asset_id: asset.id.toString(),
              retry_of_slot_id:
                videoSlot?.retry_of_slot_id == null
                  ? null
                  : videoSlot.retry_of_slot_id.toString(),
              initial_placement_status: "pending",
            },
          });
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
            next_poll_at: null,
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return false;
        const job = await tx.generation_jobs.findUnique({
          where: { id: BigInt(input.jobId) },
        });
        // IK67HE/T14：视频失败时把 pending 槽标 failed + 回写 record summary。
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
        if (job?.project_id !== null && job?.project_id !== undefined) {
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
              error: { code: input.code, message: input.message },
            },
          });
          for (const slot of pendingVideoSlots) {
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
                error: { code: input.code, message: input.message },
              },
            });
          }
        }
        // IK7G9X：失败即释放预留（reserved → released，实扣 0）。
        // IK9VZ0：releaseNote 记录退款校验结果（refund_confirmed / refund_unverified）。
        await tx.cost_reservations.updateMany({
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
      // IK7G9X：job 置 cancelled 与释放预留同事务原子完成（对齐 failVideoJob 后写模式）。
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
            next_poll_at: null,
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return false;
        // IK7G9X：派发前取消即释放预留（reserved → released，实扣 0）。
        // IK9VZ0：派发前取消未向 new-api 提交，确认无扣费 → release_note = refund_confirmed。
        await tx.cost_reservations.updateMany({
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
