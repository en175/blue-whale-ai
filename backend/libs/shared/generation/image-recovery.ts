import { processNextImageJob, type WorkerDeps } from "./worker/generation-worker.js";

/** 单轮最多处理的任务数，避免一次扫描长占事件循环。 */
const RECOVERY_BATCH_LIMIT = 20;

/** 图片生成进程内恢复扫描：reset 孤儿 processing → queued，再循环认领处理到点任务。 */
export async function recoverDueImageJobs(
  deps: WorkerDeps,
): Promise<{ reset: number; processed: number }> {
  const reset = await deps.repo.resetStalledImageJobs();
  let processed = 0;
  for (let i = 0; i < RECOVERY_BATCH_LIMIT; i += 1) {
    const id = await processNextImageJob(deps);
    if (id === null) break;
    processed += 1;
  }
  return { reset, processed };
}
