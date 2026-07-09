"use client";

/**
 * 生成流页 /generate：主区按时间倒序渲染任务卡片流（listJobs），底部为多模式输入框。
 *
 * 底部输入复用首页 AgentComposer（视频智能体 / AI 视频 / AI 图片 多 tab）。本页传 onGenerate
 * 让图片 tab 真生成（generateImage，后端已就绪）；视频/agent tab 后端未就绪，经 disabledTabs
 * 占位静默。首页 AgentComposer 不传 onGenerate，保持 router.push('/generate?prompt') 跳转。
 *
 * 闭环：首页 AgentComposer 点生成 → router.push('/generate?prompt=…') → 本页读 ?prompt 经
 * AgentComposer defaultPrompt 预填 → 用户调参点生成 → onGenerate 调 generateImage → refresh 任务流。
 *
 * 颜色一律走 globals.css 的 --tc-* / --background CSS 变量（DESIGN token），不硬编码 hex。
 */

import { useCallback, useEffect, useState } from "react";
import AgentComposer, { type GenerateContext } from "@/components/AgentComposer";
import { generateImage, getJobStatus, listJobs, type JobListItem, type OutputAsset } from "@/lib/jobs";

const TERMINAL = new Set(["succeeded", "failed"]);
const POLL_INTERVAL = 3000;

function statusLabel(s: string): string {
  switch (s) {
    case "queued":
      return "排队中";
    case "processing":
      return "生成中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return s;
  }
}

function AssetThumb({ asset }: { asset: OutputAsset }) {
  if (asset.type === "video") {
    return (
      <video
        src={asset.url}
        className="h-20 w-20 rounded-lg border border-[var(--tc-border)] object-cover"
        muted
        loop
        playsInline
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asset.url}
      alt=""
      className="h-20 w-20 rounded-lg border border-[var(--tc-border)] object-cover"
    />
  );
}

function JobCard({ job }: { job: JobListItem }) {
  const prompt = (job.input?.prompt as string | undefined) ?? "";
  return (
    <div className="rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-4">
      <div className="flex items-center justify-between">
        <span className="font-outfit text-[11px] uppercase tracking-wide text-[var(--tc-text-muted)]">
          {job.type === "image" ? "图片" : job.type === "video" ? "视频" : job.type}
        </span>
        <span
          className={
            job.status === "failed"
              ? "text-[var(--tc-destructive)]"
              : job.status === "succeeded"
                ? "text-[var(--tc-text-secondary)]"
                : "text-[var(--tc-accent)]"
          }
        >
          {statusLabel(job.status)}
        </span>
      </div>
      {prompt && (
        <p className="mt-2 line-clamp-2 text-sm text-[var(--tc-text-primary)]">{prompt}</p>
      )}
      {job.status === "processing" && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--tc-border)]">
          <div
            className="h-full rounded-full bg-[var(--tc-accent)] transition-all duration-500"
            style={{ width: `${Math.max(5, Math.min(100, job.progress))}%` }}
          />
        </div>
      )}
      {job.output_assets.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {job.output_assets.map((a) => (
            <AssetThumb key={a.id} asset={a} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function GeneratePage() {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const page = await listJobs({ size: 30 });
      setJobs(page.records);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 首屏拉任务流。
  useEffect(() => {
    // 数据获取是 React 官方认可模式；set-state-in-effect 规则对首屏 fetch 误报。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // 首页跳转带的 ?prompt 预填 AgentComposer（仅一次）。
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("prompt");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (p) setInitialPrompt(p);
  }, []);

  // 存在非终态任务时轮询 getJobStatus 推进状态；全部终态则不启动定时器。
  useEffect(() => {
    if (!jobs.some((j) => !TERMINAL.has(j.status))) return;
    const timer = window.setInterval(async () => {
      const pending = jobs.filter((j) => !TERMINAL.has(j.status));
      const results = await Promise.all(
        pending.map((j) =>
          getJobStatus(j.job_id)
            .then((s) => ({
              job_id: j.job_id,
              status: s.status,
              progress: s.progress,
              asset: s.asset,
            }))
            .catch(() => null),
        ),
      );
      setJobs((prev) =>
        prev.map((j) => {
          const r = results.find((x) => x && x.job_id === j.job_id);
          if (!r) return j;
          return {
            ...j,
            status: r.status,
            progress: r.progress,
            output_assets:
              r.asset && r.status === "succeeded"
                ? [
                    {
                      id: r.asset.id,
                      url: r.asset.url,
                      type: r.asset.type,
                      width: null,
                      height: null,
                    },
                  ]
                : j.output_assets,
          };
        }),
      );
    }, POLL_INTERVAL);
    return () => window.clearInterval(timer);
  }, [jobs]);

  // 图片 tab 真生成；视频/agent tab 占位静默（disabledTabs 已挡 handleGenerate）。
  const handleGenerate = useCallback(
    async (ctx: GenerateContext) => {
      if (ctx.tab !== "image") return;
      setGenError(null);
      try {
        await generateImage({
          prompt: ctx.prompt,
          model_id: ctx.image.modelId,
          size_id: ctx.image.resolutionId,
          aspect_ratio: ctx.image.aspectRatioId,
          quantity: 1,
        });
        refresh();
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "生成失败");
      }
    },
    [refresh],
  );

  return (
    <main className="flex min-h-screen flex-col bg-[var(--background)]">
      <div className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-4 px-4 pb-72 pt-8">
        <h1 className="font-outfit text-2xl font-semibold text-[var(--tc-text-primary)]">生成</h1>
        {error && <p className="text-sm text-[var(--tc-destructive)]">{error}</p>}
        {genError && <p className="text-sm text-[var(--tc-destructive)]">{genError}</p>}
        {loading ? (
          <p className="text-sm text-[var(--tc-text-muted)]">加载中…</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-[var(--tc-text-muted)]">
            还没有生成记录，在下方输入框描述你想生成的内容。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {jobs.map((job) => (
              <JobCard key={job.job_id} job={job} />
            ))}
          </div>
        )}
      </div>
      <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-[920px] px-4 pb-4">
        <AgentComposer
          onGenerate={handleGenerate}
          disabledTabs={["video", "agent"]}
          defaultPrompt={initialPrompt}
          dropUp
        />
      </div>
    </main>
  );
}
