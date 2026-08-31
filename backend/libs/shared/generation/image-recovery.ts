import { processNextInProcessJob, type WorkerDeps } from "./worker/generation-worker.js";

/** 单轮最多处理的任务数，避免一次扫描长占事件循环。 */
const RECOVERY_BATCH_LIMIT = 20;

/** 图片/音频生成恢复扫描（IKBGKA review 2 轮，方案 A）：
 *  - reset 孤儿 processing → queued（图片+音频统一重放）
 *  - 只对【音频】inline 处理——音频仍在 API 进程内（IKBNH2 后续迁 MQ）
 *  - 图片不再在此 inline 处理：图片已迁 RocketMQ，孤儿由 generation-worker 的
 *    RecoveryService.listDueImageJobIds → enqueueImageGenerationJob 补入队，MQ 消费端统一处理，
 *    本扫描不得再走进程内认领（否则开回无背压后门，违背 IKBGKA 目标）。 */
export async function recoverDueImageJobs(
  deps: WorkerDeps,
): Promise<{ reset: number; processed: number }> {
  const reset = await deps.repo.resetStalledImageJobs();
  let processed = 0;
  for (let i = 0; i < RECOVERY_BATCH_LIMIT; i += 1) {
    const id = await processNextInProcessJob(deps);
    if (id === null) break;
    processed += 1;
  }
  return { reset, processed };
}
