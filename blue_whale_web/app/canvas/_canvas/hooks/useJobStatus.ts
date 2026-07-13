/**
 * useJobStatus —— 视频生成任务轮询 hook
 *
 * createVideoJob 返回 jobId 后调 start(jobId)，setInterval 轮询 GET /api/jobs/{id}：
 *   succeeded → 拿 asset.url；failed → 抛错；processing → 更新 progress。
 * 组件卸载自动清理 timer。10 分钟兜底超时防泄漏。
 *
 * 文生图同步（generateImage）不走此 hook，直接 await 拿 url。
 */
import { useEffect, useRef, useState } from "react";
import { getJobStatus, type JobStatusResponse } from "../api/generation";

export type JobPollState =
  | { status: "idle" }
  | { status: "polling"; jobId: number; progress: number }
  | { status: "succeeded"; jobId: number; assetUrl: string; assetType: string }
  | { status: "failed"; jobId: number; message: string };

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

export function useJobStatus() {
  const [state, setState] = useState<JobPollState>({ status: "idle" });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  const stop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const poll = async (jobId: number) => {
    try {
      const job: JobStatusResponse = await getJobStatus(jobId);
      if (job.status === "succeeded" && job.asset) {
        stop();
        setState({
          status: "succeeded",
          jobId,
          assetUrl: job.asset.url,
          assetType: job.asset.type,
        });
      } else if (job.status === "failed") {
        stop();
        setState({ status: "failed", jobId, message: "生成失败" });
      } else {
        setState({ status: "polling", jobId, progress: job.progress ?? 0 });
      }
    } catch (e) {
      stop();
      setState({
        status: "failed",
        jobId,
        message: e instanceof Error ? e.message : "轮询失败",
      });
    }
  };

  const start = (jobId: number) => {
    stop();
    startedAtRef.current = Date.now();
    setState({ status: "polling", jobId, progress: 0 });
    timerRef.current = setInterval(() => {
      if (Date.now() - startedAtRef.current > MAX_POLL_DURATION_MS) {
        stop();
        setState({ status: "failed", jobId, message: "轮询超时" });
        return;
      }
      void poll(jobId);
    }, POLL_INTERVAL_MS);
    void poll(jobId);
  };

  const reset = () => {
    stop();
    setState({ status: "idle" });
  };

  useEffect(() => stop, []);

  return { state, start, reset };
}
