/**
 * useVideoJobs —— 生成任务并发轮询 hook（image/video 通用，canvas-v2 用）
 *
 * 每个 generation_job_id 独立 setInterval + 独立回调，互不覆盖 → 多任务可同时生成 / recover 多个 processing job。
 * 轮询层「纯粹」：只管 jobId 生命周期（轮询 / 超时 / 清理）+ 触发回调，不碰节点、不碰业务 state；
 * nodeId 映射、写 recipe/assetId 由调用方经回调闭包注入（业务编排层 useCanvasGeneration 负责）。
 *
 * IK4AK6 接 Node：getJobStatus 返回 JobStatusData（asset{id,url,type}|null，failed→error.message）。
 * 原名 useVideoJobs 遗留——image/video 共用。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getJobStatus, type JobStatusData } from "../api/generation";

export type VideoJobResult = { assetId: string; assetUrl: string; assetType: string };
export type VideoJobCallbacks = {
  onProgress?: (progress: number) => void;
  onSucceeded: (result: VideoJobResult) => void;
  onFailed: (message: string) => void;
  onCancelled?: () => void;
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

type Entry = { timer: ReturnType<typeof setInterval>; startedAt: number };

export function useVideoJobs() {
  const jobsRef = useRef<Map<number, Entry>>(new Map());

  const stop = useCallback((jobId: number) => {
    const e = jobsRef.current.get(jobId);
    if (e) {
      clearInterval(e.timer);
      jobsRef.current.delete(jobId);
    }
  }, []);

  const stopAll = useCallback(() => {
    for (const e of jobsRef.current.values()) clearInterval(e.timer);
    jobsRef.current.clear();
  }, []);

  const poll = useCallback(
    async (jobId: number, cb: VideoJobCallbacks) => {
      try {
        const job: JobStatusData = await getJobStatus(jobId);
        if (job.status === "succeeded" && job.asset) {
          stop(jobId);
          cb.onSucceeded({ assetId: String(job.asset.id), assetUrl: job.asset.url, assetType: job.asset.type });
        } else if (job.status === "failed") {
          stop(jobId);
          cb.onFailed(job.error?.message ?? "生成失败");
        } else if (job.status === "cancelled") {
          stop(jobId);
          cb.onCancelled?.();
        } else {
          cb.onProgress?.(job.progress ?? 0);
        }
      } catch (e) {
        stop(jobId);
        cb.onFailed(e instanceof Error ? e.message : "轮询失败");
      }
    },
    [stop],
  );

  /** 启动一个 job 的轮询；同 jobId 再次 start 会先清旧 timer（幂等，防重复轮询）。 */
  const start = useCallback(
    (jobId: number, cb: VideoJobCallbacks) => {
      stop(jobId);
      jobsRef.current.set(jobId, {
        startedAt: Date.now(),
        timer: setInterval(() => {
          const e = jobsRef.current.get(jobId);
          if (e && Date.now() - e.startedAt > MAX_POLL_DURATION_MS) {
            stop(jobId);
            cb.onFailed("轮询超时");
            return;
          }
          void poll(jobId, cb);
        }, POLL_INTERVAL_MS),
      });
      void poll(jobId, cb);
    },
    [stop, poll],
  );

  /** 当前在途 job 数（业务层据此判断"是否还有生成中"）。 */
  const activeCount = useCallback(() => jobsRef.current.size, []);

  useEffect(() => stopAll, [stopAll]);

  // useMemo 稳定返回对象：消费方（startJob → recover → load effect）
  // 依赖此对象；每 render 新对象字面量会击穿依赖链，导致 load effect 反复重跑被守卫挡回、nodes 永不 set。
  return useMemo(() => ({ start, stop, stopAll, activeCount }), [start, stop, stopAll, activeCount]);
}
