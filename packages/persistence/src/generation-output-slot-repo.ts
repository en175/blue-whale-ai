/** 输出槽的纯状态规则（IK67HE/T14，spec §4.4 / ADR-0026）。
 * 写入由命令/worker 事务负责；这里集中逻辑槽折叠与汇总，避免读写路径各算一套。 */

/** 槽位状态（与契约 generationOutputSlotStatusSchema 对齐）。 */
export type OutputSlotStatus = "pending" | "succeeded" | "failed" | "missing";

/** 聚合汇总状态（与契约 generationJobSummaryStatusSchema / record 四态对齐）。 */
export type SlotSummaryStatus = "generating" | "partial" | "success" | "failed";

/** 按槽状态聚合汇总状态（spec §4.4 状态机）：
 *  - 全 succeeded → success
 *  - 全 failed/missing → failed
 *  - 至少一个 succeeded 且至少一个 failed/missing → partial
 *  - 存在 pending → generating（尚有未终态槽） */
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

/** 将同一 record 下的历史尝试折叠为固定逻辑槽。
 * 成功是永久终态；否则以该 slot_index 最新一次尝试为准。 */
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
