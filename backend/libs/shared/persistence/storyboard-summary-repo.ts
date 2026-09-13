// 从原 generation-worker-internals.ts 保留的唯一运行时函数（API 取消路径回写分镜预览汇总态）。
import type { Prisma } from "@prisma/client";

import { appendProjectEvent } from "./product-event-repo.js";
import {
  aggregateSlotStatus,
  resolveLogicalSlots,
  type OutputSlotStatus,
} from "./generation-output-slot-repo.js";

/** 回写 StoryboardPreview.summary_status（图片路径，IK67HF/T15）：按 first_generation_job_id
 *  反查预览，聚合该 job 的 output_slots 推进汇总态。与 syncRecordSummary 对偶——视频走 record
 *  外键（scene_card_generation_record_id），图片 job 不设该外键，故走 first_generation_job_id 反查。 */
export async function syncStoryboardPreviewSummary(
  tx: Prisma.TransactionClient,
  jobId: bigint,
): Promise<void> {
  const preview = await tx.storyboard_previews.findFirst({
    where: { first_generation_job_id: jobId, is_delete: 0 },
    select: { id: true, project_id: true },
  });
  if (!preview) return;
  const slots = await tx.generation_output_slots.findMany({
    where: { generation_job_id: jobId },
    select: { slot_index: true, status: true },
    orderBy: { id: "asc" },
  });
  if (slots.length === 0) return;
  const summary = aggregateSlotStatus(
    resolveLogicalSlots(
      slots.map((s) => ({
        slot_index: s.slot_index,
        status: s.status as OutputSlotStatus,
      })),
    ).map((s) => s.status),
  );
  const mapped =
    summary === "generating"
      ? "generating"
      : summary === "partial"
        ? "partial"
        : summary === "success"
          ? "success"
          : "failed";
  const updated = await tx.storyboard_previews.update({
    where: { id: preview.id },
    data: { summary_status: mapped, version: { increment: 1 } },
  });
  if (preview.project_id != null) {
    await appendProjectEvent(tx, {
      projectId: preview.project_id.toString(),
      eventType: "storyboard_preview.summary_changed",
      aggregateType: "storyboard_preview",
      aggregateId: preview.id.toString(),
      aggregateVersion: updated.version,
      correlationId: `preview_${preview.id.toString()}`,
      payload: { preview_id: preview.id.toString(), summary_status: mapped },
    });
  }
}
