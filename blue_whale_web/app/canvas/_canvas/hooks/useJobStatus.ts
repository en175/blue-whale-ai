/**
 * useJobStatus —— 生成任务轮询 hook（单 job）
 *
 * createProjectGenerationJob 返回 generation_job_id 后调 start(jobId)，
 * setInterval 轮询 GET /api/jobs/{id}：
 *   succeeded → 拿 asset.url；failed → 抛错；processing → 更新 progress。
 * 组件卸载自动清理 timer。10 分钟兜底超时防泄漏。
 *
 * IK4AK6 接 Node：getJobStatus 返回 JobStatusData（asset{id,url,type}|null）。
 * canvas-v2 多 job 并发用 useVideoJobs；本 hook 保留给单 job 场景。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getJobStatus, type JobStatusData } from "../api/generation";
import type { WireInteger } from "@/lib/wire-integer";

export type JobPollState =
  | { status: "idle" }
  | { status: "polling"; jobId: WireInteger; progress: number }
  | {
      status: "succeeded";
      jobId: WireInteger;
      assetId: string;
      assetUrl: string;
      assetType: string;
    }
  | { status: "failed"; jobId: WireInteger; message: string };

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

export function useJobStatus() {
  const [state, setState] = useState<JobPollState>({ status: "idle" });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  // useCallback 稳定引用：消费方 effect 若依赖 start/reset，普通函数字面量会每次 render 新引用，
  // 导致 effect 重跑→setState→重 render→effect 重跑 死循环（polling 时触发 Maximum update depth）。
  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const poll = useCallback(
    async (jobId: WireInteger) => {
      try {
        const job: JobStatusData = await getJobStatus(jobId);
        if (job.status === "succeeded" && job.asset) {
          stop();
          setState({
            status: "succeeded",
            jobId,
            assetId: String(job.asset.id),
            assetUrl: job.asset.url,
            assetType: job.asset.type,
          });
        } else if (job.status === "failed") {
          stop();
          const message = job.error?.message ?? "生成失败";
          setState({ status: "failed", jobId, message });
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
    },
    [stop],
  );

  const start = useCallback(
    (jobId: WireInteger) => {
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
    },
    [stop, poll],
  );

  const reset = useCallback(() => {
    stop();
    setState({ status: "idle" });
  }, [stop]);

  useEffect(() => stop, []);

  return { state, start, reset };
}
