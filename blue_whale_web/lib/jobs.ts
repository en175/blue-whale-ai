/**
 * jobs —— GenerationJob 领域映射 + 任务列表/轮询/文生图请求层。
 *
 * 位置：`blue_whale_web/lib/jobs.ts` —— 顶层 lib（非 _canvas 内部），证明领域类型可被
 * 非画布模块使用。
 *
 * 本文件承载两部分：
 *   1. 领域类型纯映射（不引 UI 标签/中文文案）：
 *      - Job.status → Card.status 视图映射（CONTEXT.md L79-80）
 *      - Job 是否终态判断
 *   2. 请求层：任务列表、状态轮询、文生图触发（generate 页用）。
 *
 * UI 标签（"排队中"/"生成中"等）属 UI 层职责，不在本文件。
 * 请求层字段全 snake_case 对齐后端 Jackson SNAKE_CASE 序列化。
 */

import type {
  CardStatus,
  GenerationJob,
  GenerationJobStatus,
} from "@/types/domain";
import { request, type Paged } from "./api";

/**
 * GenerationJob 状态 → Card 视图状态（CONTEXT.md L79-80 视图映射）。
 *
 *   queued     → generating（视为过渡态，与 processing UI 一致）
 *   processing → generating
 *   succeeded  → normal
 *   failed     → failed
 */
export function mapJobStatusToCardStatus(
  status: GenerationJobStatus,
): CardStatus {
  switch (status) {
    case "queued":
    case "processing":
    case "cancel_requested":
      return "generating";
    case "succeeded":
    case "partially_succeeded":
      return "normal";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

/** Job 是否处于终态（不再有状态转移）。succeeded / failed 都是终态。 */
export function isJobTerminal(job: GenerationJob): boolean {
  return (
    job.status === "succeeded" ||
    job.status === "partially_succeeded" ||
    job.status === "failed" ||
    job.status === "cancelled"
  );
}

/** 任务产出资源缩略。宽高后端可能为 null（视频）。 */
export type OutputAsset = {
  id: number;
  url: string;
  type: string;
  width: number | null;
  height: number | null;
};

/** 任务列表项（GET /api/jobs records）。 */
export type JobListItem = {
  job_id: number;
  type: string;
  status: string;
  progress: number;
  input: Record<string, unknown> | null;
  created_at: string | null;
  output_assets: OutputAsset[];
};

/** 轮询单任务状态（GET /api/jobs/{id}）。 */
export type JobStatus = {
  job_id: number;
  status: string;
  progress: number;
  asset: { id: number; url: string; type: string } | null;
};

/** 图片模型能力（仅取 generate 页默认生成所需字段）。 */
export type ImageModel = {
  model_id: string;
  default_size: string;
  default_aspect_ratio: string;
};

export type ImageResult = { asset_id: number; url: string };

export type ListJobsParams = {
  type?: string;
  status?: string;
  projectId?: number;
  page?: number;
  size?: number;
};

/** 任务列表（生成流页）：按 type/status/projectId 过滤 + 分页，按创建时间倒序。 */
export function listJobs(
  params: ListJobsParams = {},
): Promise<Paged<JobListItem>> {
  const q = new URLSearchParams();
  if (params.type) q.set("type", params.type);
  if (params.status) q.set("status", params.status);
  if (params.projectId != null) q.set("projectId", String(params.projectId));
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 30));
  return request<Paged<JobListItem>>(`/jobs?${q.toString()}`, "GET");
}

/** 轮询查任务状态。 */
export function getJobStatus(jobId: number): Promise<JobStatus> {
  return request<JobStatus>(`/jobs/${jobId}`, "GET");
}

/** 取启用图片模型能力，供 generate 页选默认模型。 */
export function listImageModels(): Promise<ImageModel[]> {
  return request<ImageModel[]>("/generation/models?capability=image", "GET");
}

/** 文生图同步生成，返回 asset id + url。 */
export function generateImage(payload: {
  prompt: string;
  model_id: string;
  size_id: string;
  aspect_ratio?: string;
  quantity?: number;
}): Promise<ImageResult> {
  return request<ImageResult>("/generation/image", "POST", payload);
}
