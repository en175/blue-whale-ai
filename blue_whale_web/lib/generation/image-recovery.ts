/** 图片生成进程内恢复扫描。
 *
 * 背景：视频走独立 BullMQ worker（workers/generation-worker.ts），自带重试 + recoverDueVideoJobs；
 * 图片仍在 Next.js 进程内调度（路由 void processJob），两类线上故障因此无人兜底——
 *   - 进程重启（部署）杀死 in-flight 的 fire-and-forget → job 永久 orphan 在 queued（线上 job 420）；
 *   - 瞬时网络失败一次即判死（线上 job 416「new-api 不可达」，实测 new-api 可达、重试即可成功）。
 *
 * 本模块由 instrumentation.ts 在 Next 服务端启动时按分钟调用：
 *   1) resetStalledImageJobs：租约过期仍 processing 的孤儿图片任务 → queued；
 *   2) 循环 processNextImageJob：认领并处理到点的图片 queued 任务（含瞬时失败回 queue 的重试）。
 */
import type { WorkerDeps } from "./worker/generation-worker";
import { processNextImageJob } from "./worker/generation-worker";

/** 单轮最多处理的任务数，避免一次扫描长占事件循环。 */
const RECOVERY_BATCH_LIMIT = 20;

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
