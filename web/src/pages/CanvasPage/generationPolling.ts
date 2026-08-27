/** Stop a cancelled generation node's scheduled poll and remove it from the canvas. */
export function removeCancelledGenerationNode(
  nodeId: string,
  jobTimers: Map<string, number>,
  removeNode: (nodeId: string) => void,
  clearTimer: (timer: number) => void = (timer) => window.clearTimeout(timer),
) {
  const timer = jobTimers.get(nodeId);
  if (timer !== undefined) {
    clearTimer(timer);
    jobTimers.delete(nodeId);
  }

  removeNode(nodeId);
}
