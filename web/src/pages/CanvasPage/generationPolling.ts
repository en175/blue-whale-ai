/** Stop a cancelled generation node's scheduled poll and remove it from the canvas. */
export function removeCancelledGenerationNode(
  nodeId: string,
  jobTimers: Map<string, number>,
  removeNode: (nodeId: string) => void,
  clearTimer: (timer: number) => void = (timer) => window.clearTimeout(timer),
) {
  stopJobPolling(nodeId, jobTimers, clearTimer);
  removeNode(nodeId);
}

/** Stop a settled node's scheduled poll without removing the node（IKDMQW：取消回待生成等保留卡片的终态收敛）. */
export function stopJobPolling(
  nodeId: string,
  jobTimers: Map<string, number>,
  clearTimer: (timer: number) => void = (timer) => window.clearTimeout(timer),
) {
  const timer = jobTimers.get(nodeId);
  if (timer !== undefined) {
    clearTimer(timer);
    jobTimers.delete(nodeId);
  }
}
