
export type OutputSlotStatus = "pending" | "succeeded" | "failed" | "missing";

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
