/* ============================================
 * jobs 接口：生成任务创建/取消/重试/轮询/列表
 * 创建与重试需 Idempotency-Key（UUID）幂等头
 * ============================================ */
import { apiRequest, isApiError, type ApiError } from './http';

/** 可由普通生成端点创建的任务类型 */
export type GenerationJobType = 'image' | 'video' | 'audio';

/** 通用任务查询可能返回媒体提取任务。 */
export type JobType = GenerationJobType | 'media_extract';

/** 任务状态：queued/processing 为进行中，succeeded/failed/cancelled 为终态 */
export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

/** 任务产物 */
export interface JobAsset {
  /** 产物资产ID（string） */
  id: string;
  /** 产物访问 URL */
  url: string;
  /** 产物类型 */
  type: GenerationJobType;
  width?: number | null;
  height?: number | null;
  /** 时长秒（视频/音频产物；后端未必返回，缺失时前端用浏览器实测补齐） */
  duration?: number | null;
}

/**
 * 任务失败信息。
 * - 轮询 GET /api/jobs/:id：失败已升到顶层 `{ code: 数值, msg: 中文 }`，由 fetchJobStatus 收敛到此
 * - 快照 generation_jobs[].error：仍是挂在任务上的 `{ code: 数值, message: 中文 }`
 */
export interface JobError {
  code: number | string;
  msg?: string;
  message?: string;
}

/** 生成任务领域错误码 1000-1099（IKBQEE 二期，quota_exhausted=1001）。 */
export const GENERATION_DOMAIN_CODE_MIN = 1000;
export const GENERATION_DOMAIN_CODE_MAX = 1099;

export function isGenerationDomainError(e: unknown): e is ApiError {
  if (!isApiError(e)) return false;
  const n = typeof e.code === 'number' ? e.code : Number(e.code);
  return Number.isInteger(n) && n >= GENERATION_DOMAIN_CODE_MIN && n <= GENERATION_DOMAIN_CODE_MAX;
}

/** 失败文案：优先顶层/对象 msg，其次旧字段 message。 */
export function readJobFailText(
  error?: { msg?: string | null; message?: string | null } | null,
): string {
  for (const value of [error?.msg, error?.message]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
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
  /** IKG0LP：是否生成带音频的视频（用户选择，缺省 true）。
   *  仅当模型能力位 features.audio 为 true 时前端才提供该选择；
   *  契约：docs/specs/2026-09-15-ikg0lp-video-generate-audio-contract.md */
  generate_audio?: boolean;
}

/** 音频生成参数 */
export interface AudioJobParameters {
  prompt: string;
  model_id: string;
}

/** POST /api/projects/:id/generation-jobs 请求体 */
export interface CreateJobPayload {
  type: GenerationJobType;
  /** 旧参考字段（图片曾用）；新提交走 references，与视频/音频对齐 */
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
  /** 首帧素材库素材ID（仅 video，Asset- 前缀；与 first_frame_asset_id 同帧位互斥） */
  first_frame_material_id?: string;
  /** 尾帧素材库素材ID（仅 video，Asset- 前缀；须与首帧同传） */
  last_frame_material_id?: string;
  /** 素材库参考素材（仅 video）：[{ id: "Asset-xxx", type: "image" | "video" }]；与首尾帧模式互斥 */
  reference_materials?: Array<{ id: string; type: 'image' | 'video' }>;
  /**
   * 图/视频/音频生成参考单数组（保序，与旧参考字段互斥）。
   * 每项 asset_id（本地）与 material_id（素材库 asset- 前缀）二选一。
   * 图片/音频 role 恒 reference；视频可含 first_frame / last_frame。
   */
  references?: GenerationRefItem[];
  /** 生成目标画布节点 id（仅 image/video，IKDLQF/IKDLQG）：携带时服务端按最新画布推导连线文本附件并冻结进任务快照 */
  target_node_id?: string;
}

/** 生成任务参考项（图/视频/音频 references 契约） */
export interface GenerationRefItem {
  role: 'first_frame' | 'last_frame' | 'reference';
  type: 'image' | 'video' | 'audio';
  asset_id?: string;
  material_id?: string;
}

/** 创建/重试任务返回 */
export interface JobCreatedData {
  /** 生成任务ID，用于轮询。后端返回字符串（CreatedJob.generation_job_id: string），勿当 number 存。 */
  generation_job_id: string;
  /** 事件游标（服务端事件序号） */
  cursor: number;
}

/** POST /api/projects/:id/media-extractions 请求体。当前后端仅支持 MP3 整段提取。 */
export interface CreateMediaExtractionPayload {
  source_asset_id: string | number;
  output_format?: 'mp3';
}

/** 创建媒体提取任务返回。 */
export interface MediaExtractionCreatedData {
  job_id: string;
  status: 'queued';
}

/** GET /api/jobs/:id 返回（成功无 error；失败由 fetchJobStatus 补 error.msg） */
export interface JobDetail {
  job_id: number | string;
  status: JobStatus;
  /** 进度百分比 0-100 */
  progress: number;
  /** 产物信息，succeeded 时有值 */
  asset: JobAsset | null;
  /** 文本输入签名投影（IKFM3S）：succeeded 时前端回写目标节点 usedInputSignature；无则 null */
  text_input_signature?: string | null;
  error?: JobError | null;
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
  error?: JobError | null;
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

/** 视频整段提取音频；音频占位节点及最终节点由后端写入画布快照。 */
export function createMediaExtraction(
  projectId: string,
  payload: CreateMediaExtractionPayload,
): Promise<MediaExtractionCreatedData> {
  return apiRequest<MediaExtractionCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/media-extractions`,
    {
      method: 'POST',
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

/** 轮询任务状态 GET /api/jobs/:id。
 *  失败任务 HTTP 仍可能是 200，但信封 code 为 1xxx + 顶层 msg；apiRequest 会抛 ApiError。
 *  此处把领域错误收敛成 status=failed，文案走 msg，避免轮询 catch 当成网络抖动重试。 */
export async function fetchJobStatus(jobId: number | string): Promise<JobDetail> {
  try {
    return await apiRequest<JobDetail>(`/api/jobs/${jobId}`, { silent: true });
  } catch (e) {
    if (isGenerationDomainError(e)) {
      return {
        job_id: jobId,
        status: 'failed',
        progress: 0,
        asset: null,
        error: { code: e.code, msg: e.message },
      };
    }
    throw e;
  }
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
