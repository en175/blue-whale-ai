/**
 * useVideoJobs —— 生成任务并发轮询 hook（image/video 通用，canvas-v2 用）。
 *
 * 所有在途 Job 共用一个 3 秒 timer，每轮通过 GET /api/jobs?ids=... 精确批量读取。
 * 回调仍按 Job 独立派发，轮询层不碰节点或业务 state。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { listJobs } from "../api/generation";

export type VideoJobResult = { assetId: string; assetUrl: string; assetType: string };
export type VideoJobCallbacks = {
  onProgress?: (progress: number) => void;
  onSucceeded: (result: VideoJobResult) => void;
  onFailed: (message: string) => void;
  onCancelled?: () => void;
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;
const MAX_BATCH_IDS = 100;

type Entry = { callbacks: VideoJobCallbacks; startedAt: number; missingPolls: number };

export function useVideoJobs(projectId?: number | string) {
  const jobsRef = useRef<Map<number, Entry>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const stop = useCallback((jobId: number) => {
    jobsRef.current.delete(jobId);
    if (jobsRef.current.size === 0 && timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopAll = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    jobsRef.current.clear();
  }, []);

  const pollAll = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const ids = [...jobsRef.current.keys()];
    if (ids.length === 0) return;
    const run = (async () => {
      try {
        const records = (
          await Promise.all(
            Array.from({ length: Math.ceil(ids.length / MAX_BATCH_IDS) }, (_, index) =>
              listJobs({
                projectId,
                jobIds: ids.slice(index * MAX_BATCH_IDS, (index + 1) * MAX_BATCH_IDS),
              }),
            ),
          )
        ).flat();
        const byId = new Map(records.map((record) => [Number(record.job_id), record]));
        for (const [jobId, entry] of [...jobsRef.current.entries()]) {
          const record = byId.get(jobId);
          if (!record) {
            // 记录缺失 ≠ 任务失败：可能是刚建未可见 / 查询时序 / 批量边界。
            // 不判死、继续轮询；真正失败由 record.status === "failed" 判定，
            // 长期不出现由 MAX_POLL_DURATION 超时兜底。避免「任务不存在」假失败。
            entry.missingPolls += 1;
            if (entry.missingPolls === 1) {
              console.warn(
                `[useVideoJobs] job ${jobId} not in listJobs response, keep polling (not a failure)`,
              );
            }
            continue;
          }
          entry.missingPolls = 0;
          if (record.status === "succeeded" && record.output_assets[0]) {
            stop(jobId);
            const asset = record.output_assets[0];
            entry.callbacks.onSucceeded({ assetId: String(asset.id), assetUrl: asset.url, assetType: asset.type });
          } else if (record.status === "failed") {
            stop(jobId);
            entry.callbacks.onFailed(record.error?.message ?? "生成失败");
          } else if (record.status === "cancelled") {
            stop(jobId);
            entry.callbacks.onCancelled?.();
          } else {
            entry.callbacks.onProgress?.(record.progress ?? 0);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "轮询失败";
        for (const [jobId, entry] of [...jobsRef.current.entries()]) {
          stop(jobId);
          entry.callbacks.onFailed(message);
        }
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [projectId, stop]);

  const tick = useCallback(() => {
    const now = Date.now();
    for (const [jobId, entry] of [...jobsRef.current.entries()]) {
      if (now - entry.startedAt > MAX_POLL_DURATION_MS) {
        stop(jobId);
        entry.callbacks.onFailed("轮询超时");
      }
    }
    void pollAll();
  }, [pollAll, stop]);

  const ensureTimer = useCallback(() => {
    if (timerRef.current === null) {
      timerRef.current = setInterval(tick, POLL_INTERVAL_MS);
    }
  }, [tick]);

  const start = useCallback(
    (jobId: number, callbacks: VideoJobCallbacks) => {
      stop(jobId);
      jobsRef.current.set(jobId, { callbacks, startedAt: Date.now(), missingPolls: 0 });
      ensureTimer();
    },
    [ensureTimer, stop],
  );

  const activeCount = useCallback(() => jobsRef.current.size, []);

  useEffect(() => stopAll, [stopAll]);

  return useMemo(() => ({ start, stop, stopAll, activeCount }), [start, stop, stopAll, activeCount]);
}
