import type { PrismaClient } from "@prisma/client";

import { syncStoryboardPreviewSummary } from "./generation-worker-internals.js";
import { appendProjectEvent } from "./product-event-repo.js";

/** 图片供应商为长调用：取消确认撤销本任务写入权，不依赖供应商支持中断。 */
export async function cancelImageJob(
  prisma: PrismaClient,
  jobId: string,
  userId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // 与领取、产物写入和成功结算争用同一行锁；先完成的终态获胜。
    const cancelled = await tx.generation_jobs.updateMany({
      where: {
        id: BigInt(jobId), user_id: BigInt(userId), type: "image",
        is_delete: false, status: { in: ["queued", "processing"] },
      },
      data: {
        status: "cancelled", cancel_requested_at: new Date(),
        next_action_at: null, lease_owner: null, lease_expires_at: null,
        fencing_token: { increment: 1 }, version: { increment: 1 },
      },
    });
    if (cancelled.count !== 1) {
      // 同一取消命令重放安全；成功/失败终态不接受取消。
      return (await tx.generation_jobs.count({ where: {
        id: BigInt(jobId), user_id: BigInt(userId), type: "image",
        is_delete: false, status: "cancelled", cancel_requested_at: { not: null },
      } })) === 1;
    }
    const job = await tx.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } });
    const slots = await tx.generation_output_slots.findMany({
      where: { generation_job_id: job.id, status: "pending" },
    });
    await tx.generation_output_slots.updateMany({
      where: { generation_job_id: job.id, status: "pending" },
      data: { status: "failed" },
    });
    await tx.cost_reservations.updateMany({
      where: { generation_job_id: job.id, status: "reserved" },
      // 本地释放预留不证明外部退款；可能已有在途调用，保留待核对标记。
      data: { status: "released", actual_amount_fen: 0n, release_note: "refund_unverified" },
    });
    await tx.generation_job_logs.create({ data: {
      generation_job_id: job.id, event: "cancelled", status: "cancelled",
      message: "用户取消，已停止接纳本任务结果",
    } });
    if (job.project_id !== null) {
      await appendProjectEvent(tx, {
        projectId: String(job.project_id), eventType: "generation_job.status_changed",
        aggregateType: "generation_job", aggregateId: jobId,
        aggregateVersion: job.version, correlationId: `job_${jobId}`,
        payload: { job_id: jobId, type: job.type, source: job.source, status: job.status, progress: job.progress },
      });
      for (const slot of slots) {
        await appendProjectEvent(tx, {
          projectId: String(job.project_id), eventType: "generation_job.output_updated",
          aggregateType: "generation_job_output", aggregateId: `${jobId}:${slot.slot_index}`,
          aggregateVersion: 0, correlationId: `job_${jobId}`,
          payload: {
            job_id: jobId, slot_id: String(slot.id), slot_index: slot.slot_index,
            status: "failed", asset_id: null,
            retry_of_slot_id: slot.retry_of_slot_id == null ? null : String(slot.retry_of_slot_id),
            initial_placement_status: "pending",
          },
        });
      }
    }
    await syncStoryboardPreviewSummary(tx, job.id);
    return true;
  });
}
