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


export function imageJobLeaseSeconds(): number {
  const raw = Number.parseInt(process.env.IMAGE_JOB_LEASE_SECONDS ?? "", 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 120;
}
