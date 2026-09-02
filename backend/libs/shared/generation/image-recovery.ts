import { type WorkerDeps } from "./worker/generation-worker.js";

/** 单轮最多处理的任务数，避免一次扫描长占事件循环。 */
const RECOVERY_BATCH_LIMIT = 20;

/** 生成恢复扫描（IKBGKA review 2 轮，方案 A；IKCR78 收口）：
 *  - reset 孤儿 processing → queued（图片+音频统一重放；递增 fencing_token 使 stale worker 写失效）
 *  - 不再 inline 处理任何任务：图片已迁 RocketMQ（IKBGKA）、音频已迁 RocketMQ（IKCR78），
 *    孤儿/卡住任务由 generation-worker 的 RecoveryService 低频补入队（listDueImageJobIds /
 *    listDueAudioJobIds → enqueue* ），MQ 消费端（Semaphore 背压）统一处理。
 *    本扫描不得再走进程内认领（否则开回无背压后门，违背 IKBGKA/IKCR78 目标）。 */
export async function recoverDueImageJobs(
  deps: WorkerDeps,
): Promise<{ reset: number; processed: number }> {
  const reset = await deps.repo.resetStalledImageJobs();
  // IKCR78：音频不再 inline 处理（已迁 MQ）。返回 processed 恒 0，保留签名兼容。
  return { reset, processed: 0 };
}
