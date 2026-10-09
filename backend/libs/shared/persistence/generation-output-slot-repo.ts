
export type OutputSlotStatus = "pending" | "succeeded" | "failed" | "missing";

export type SlotSummaryStatus = "generating" | "partial" | "success" | "failed";

export function aggregateSlotStatus(
  statuses: OutputSlotStatus[],
): SlotSummaryStatus {
  if (statuses.length === 0) return "failed";
  if (statuses.some((s) => s === "pending")) return "generating";
  const succeeded = statuses.filter((s) => s === "succeeded").length;
  if (succeeded === statuses.length) return "success";
  if (succeeded === 0) return "failed";
  return "partial";
}

export function resolveLogicalSlots<
  T extends { slot_index: number; status: OutputSlotStatus },
>(slots: T[]): T[] {
  const resolved = new Map<number, T>();
  for (const slot of slots) {
    const current = resolved.get(slot.slot_index);
    if (
      !current ||
      current.status !== "succeeded" ||
      slot.status === "succeeded"
    ) {
      resolved.set(slot.slot_index, slot);
    }
  }
  return [...resolved.values()].sort((a, b) => a.slot_index - b.slot_index);
}
