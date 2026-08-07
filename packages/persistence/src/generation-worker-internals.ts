// IK74V8：从 generation-worker-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 事务内共享工具：可领取来源白名单、聚合状态回写、镜像租约。
import type { Prisma } from "@prisma/client";

import { appendProjectEvent } from "./product-event-repo.js";
import {
  aggregateSlotStatus,
  resolveLogicalSlots,
  type OutputSlotStatus,
} from "./generation-output-slot-repo.js";

export const CLAIMABLE_JOB_SOURCES = [
  "bottom_dock",
  "plan_apply",
  "storyboard_preview",
];

/** IK67HE/T14：聚合 record 下全部输出槽状态，回写 SceneCardGenerationRecord.summary_status。
 *  spec §4.4 状态机：全成功→success；部分→partial；全失败→failed；有 pending→generating。
 *  在 worker completeJob/failJob 事务内调用，保证槽位与 record 状态原子一致。 */
export async function syncRecordSummary(
  tx: Prisma.TransactionClient,
  recordId: bigint,
): Promise<void> {
  const slots = await tx.generation_output_slots.findMany({
    where: { scene_card_generation_record_id: recordId },
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
  const record = await tx.scene_card_generation_records.update({
    where: { id: recordId },
    data: { summary_status: mapped, version: { increment: 1 } },
  });
  if (record.project_id != null) {
    await appendProjectEvent(tx, {
      projectId: record.project_id.toString(),
      eventType: "scene_card_generation_record.summary_changed",
      aggregateType: "scene_card_generation_record",
      aggregateId: recordId.toString(),
      aggregateVersion: record.version,
      correlationId: `record_${recordId.toString()}`,
      payload: { record_id: recordId.toString(), summary_status: mapped },
    });
  }
}

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

/** 生成 worker 的 DB port：轮询认领 queued 任务 + 调 provider 后落产出/状态/结算。
 *  简化模型：一次任务整体处理（产出多张图时全写 output_asset_ids 数组，不做多槽）。 */

export function imageJobLeaseSeconds(): number {
  const raw = Number.parseInt(process.env.IMAGE_JOB_LEASE_SECONDS ?? "", 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 120;
}
