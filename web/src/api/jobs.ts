/* ============================================
 * jobs 接口：生成任务创建/取消/重试/轮询/列表
 * 创建与重试需 Idempotency-Key（UUID）幂等头
 * ============================================ */
import { apiRequest } from './http';

/** 生成类型 */
export type JobType = 'image' | 'video' | 'audio';

/** 任务状态：queued/processing 为进行中，succeeded/failed/cancelled 为终态 */
export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

/** 任务产物 */
export interface JobAsset {
  /** 产物资产ID（string） */
  id: string;
  /** 产物访问 URL */
  url: string;
  /** 产物类型 */
  type: JobType;
  width?: number | null;
  height?: number | null;
}

/** 任务错误信息（failed 时有值） */
export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
}

/** 图片生成参数 */
export interface ImageJobParameters {
  prompt: string;
  model_id: string;
  aspect_ratio: string;
  /** 分辨率档位 id，如 2k */
  size: string;
  web_search?: boolean;
  sequential_image_generation?: boolean;
}

/** 视频生成参数 */
export interface VideoJobParameters {
  prompt: string;
  model_id: string;
  aspect_ratio: string;
  /** 分辨率，如 1080p */
  resolution: string;
  /** 时长（秒） */
  duration: number;
}

/** 音频生成参数 */
export interface AudioJobParameters {
  prompt: string;
  model_id: string;
}

/** POST /api/projects/:id/generation-jobs 请求体 */
export interface CreateJobPayload {
  type: JobType;
  /** 输入参考资产ID列表（仅 image） */
  input_asset_ids?: (string | number)[];
  /** 期望生成数量 */
  expected_output_count: number;
  parameters: ImageJobParameters | VideoJobParameters | AudioJobParameters;
  /** 首帧资产ID（仅 video，图片；后端兼容字符串） */
  first_frame_asset_id?: number | string;
  /** 尾帧资产ID（仅 video，图片；须与首帧同传，后端兼容字符串） */
  last_frame_asset_id?: number | string;
  /** 参考资产ID列表（仅 video，图片/视频；后端兼容字符串） */
  reference_asset_ids?: (number | string)[];
}

/** 创建/重试任务返回 */
export interface JobCreatedData {
  /** 生成任务ID，用于轮询。后端返回字符串（CreatedJob.generation_job_id: string），勿当 number 存。 */
  generation_job_id: string;
  /** 事件游标（服务端事件序号） */
  cursor: number;
}

/** GET /api/jobs/:id 返回 */
export interface JobDetail {
  job_id: number;
  status: JobStatus;
  /** 进度百分比 0-100 */
  progress: number;
  /** 产物信息，succeeded 时有值 */
  asset: JobAsset | null;
  error: JobError | null;
}

/** GET /api/jobs 列表项 */
export interface JobRecord {
  job_id: number;
  type: JobType;
  status: JobStatus;
  progress: number;
  input: unknown;
  created_at: string;
  output_assets: JobAsset[];
  error: JobError | null;
}

/** GET /api/jobs 返回 */
export interface JobListData {
  records: JobRecord[];
  total: number;
  size: number;
  current: number;
}

/** 生成幂等键（每次新任务一个 UUID）。
 *  crypto.randomUUID() 仅在安全上下文（HTTPS/localhost）可用；
 *  测试站 HTTP 下不存在，降级为 getRandomValues 手动拼 v4 UUID。 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 UUID fallback
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 创建生成任务（Idempotency-Key 幂等头防重复创建） */
export function createGenerationJob(
  projectId: string,
  payload: CreateJobPayload,
): Promise<JobCreatedData> {
  return apiRequest<JobCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify(payload),
    },
  );
}

/** 取消生成任务（成功 data 为 null） */
export function cancelGenerationJob(projectId: string, jobId: number | string) {
  return apiRequest<null>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/${jobId}/cancel`,
    { method: 'POST' },
  );
}

/** 重试终态失败任务：为缺失/失败输出创建新任务 */
export function retryGenerationJob(
  projectId: string,
  jobId: number | string,
): Promise<JobCreatedData> {
  return apiRequest<JobCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/${jobId}/retry`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
    },
  );
}

/** 轮询任务状态 GET /api/jobs/:id */
export function fetchJobStatus(jobId: number | string) {
  return apiRequest<JobDetail>(`/api/jobs/${jobId}`);
}

/** GET /api/jobs 查询参数 */
export interface FetchJobsParams {
  projectId?: string;
  status?: JobStatus;
  size?: number;
  /** 批量查询指定任务ID */
  ids?: (number | string)[];
  page?: number;
}

/** 列出任务 GET /api/jobs（画布水合恢复时按状态批量查询） */
export function fetchJobs(params: FetchJobsParams = {}) {
  const qs = new URLSearchParams();
  if (params.projectId) qs.set('projectId', params.projectId);
  if (params.status) qs.set('status', params.status);
  if (params.size !== undefined) qs.set('size', String(params.size));
  if (params.ids?.length) qs.set('ids', params.ids.join(','));
  if (params.page !== undefined) qs.set('page', String(params.page));
  const suffix = qs.toString();
  return apiRequest<JobListData>(`/api/jobs${suffix ? `?${suffix}` : ''}`);
}
