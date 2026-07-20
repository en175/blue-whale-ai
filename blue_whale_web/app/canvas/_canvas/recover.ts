/**
 * recover —— 刷新恢复：把跑着的 job 映射成画布占位（design D12 方案 A）
 *
 * 刷新/重进画布，loading 占位不持久化（D5）+ jobId/SSE 句柄全丢，但 mysql job 仍
 * processing（后端 poller 照跑）。进画布扫 `GET /jobs?projectId&status=processing`，
 * 给每个 job 重建占位 loading 节点（稳定 id `job-{jobId}` 去重），续上视频轮询 /
 * 图片流式 SSE（后端 JobStreamBus 补发历史）。
 *
 * 本文件只做纯映射（job → 占位 patch），网络/续订在 page.tsx 编排。
 */
import type { JobListItem } from "./api/generation";
import { parseAspectRatio } from "./aspectRatio";
import type { NodeItem, NodeType } from "./types";

export type JobPlaceholder = {
  /** 稳定去重 id：同 jobId 刷新多次只建一个占位。 */
  id: string;
  type: NodeType;
  patch: Partial<NodeItem>;
};

/**
 * processing job → 占位 patch：content 取 input.prompt、status=loading、
 * 尺寸按 input.aspectRatio、视频带 progress。input 缺失回退（空 prompt、1:1）。
 */
export function jobToPlaceholder(job: JobListItem): JobPlaceholder {
  const input = job.input ?? {};
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const aspectToken = typeof input.aspectRatio === "string" ? input.aspectRatio : "1:1";
  const ar = parseAspectRatio(aspectToken);
  const type: NodeType = job.type === "video" ? "video" : "image";
  const patch: Partial<NodeItem> = {
    content: prompt,
    status: "loading",
    ...ar,
  };
  // 仅视频占位带 progress（图片无进度数据，design D16）
  if (type === "video" && typeof job.progress === "number") {
    patch.progress = job.progress;
  }
  return { id: `job-${job.jobId}`, type, patch };
}
