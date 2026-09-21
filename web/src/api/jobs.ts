/* ============================================
 * jobs 接口：生成任务创建/取消/重试/轮询/列表
 * 创建与重试需 Idempotency-Key（UUID）幂等头
 * ============================================ */
import { apiRequest, isApiError, type ApiError } from './http';
import type { ImageEnhanceInput } from '@lib/contracts/image-enhance';
import type { ImageEraseInput } from '@lib/contracts/image-erase';
import type { ImageCutoutInput } from '@lib/contracts/image-cutout';
import type { ImageOutpaintInput } from '@lib/contracts/image-outpaint';
import type { VideoSubtitleEraseInput } from '@lib/contracts/video-subtitle-erase';
import type { VideoEnhanceInput } from '@lib/contracts/video-enhance';
import type { MediaExtractOutputFormat } from '@lib/contracts/media-extract';
import type { VideoSceneSplitGranularity } from '@lib/contracts/video-scene-split';

/** 可由普通生成端点创建的任务类型（image_enhance / image_outpaint 走专属创建端点，不在此列） */
export type GenerationJobType = 'image' | 'video' | 'audio';

/** 通用任务查询可能返回媒体提取、高清放大、图片擦除、智能扩图、抠图与视频去字幕任务
 *  （IKGM9O / IKGOT8 / IKGOR6 / IKGXLS / IKGZ83）。 */
export type JobType = GenerationJobType | 'media_extract' | 'image_enhance' | 'image_erase' | 'image_outpaint' | 'image_cutout' | 'video_subtitle_erase';

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

/** POST /api/projects/:id/media-extractions 请求体。output_format 五值（缺省 m4a；
 *  产物文件名后缀与展示名跟随所选格式），类型与契约同源（@lib/contracts/media-extract）。 */
export interface CreateMediaExtractionPayload {
  source_asset_id: string | number;
  output_format?: MediaExtractOutputFormat;
}

/** 创建媒体提取任务返回。 */
export interface MediaExtractionCreatedData {
  job_id: string;
  status: 'queued';
}

/** POST /api/projects/:id/image-enhancements 请求体（六键，键名与 backend/libs/contracts/image-enhance.ts 契约恒等）。
 *  IKGM9O 高清放大面板提交；版本档能力矩阵与源图尺寸门槛由服务端权威复核，前端预检只是体验层。 */
export type CreateImageEnhancementPayload = ImageEnhanceInput;

/** 创建高清放大任务返回。 */
export interface ImageEnhancementCreatedData {
  job_id: string;
  status: 'queued';
}

/** POST /api/projects/:id/image-outpaints 请求体（六键，键名与 backend/libs/contracts/image-outpaint.ts 契约恒等）。
 *  IKGOR6 扩图面板提交；四比例值域与源图门槛由服务端权威复核，前端预检只是体验层。 */
export type CreateImageOutpaintPayload = ImageOutpaintInput;

/** 创建智能扩图任务返回。 */
export interface ImageOutpaintCreatedData {
  job_id: string;
  status: 'queued';
}

/** 场景切分任务结果形态（GET /api/jobs/:id 的 result 键，IKH8C1）：契约校验后的
 *  切分结果——segments 按段序排列（segment_index 1 起）、起止秒 Number、
 *  segment_asset_id 指向 output_assets 里的段资产。非场景切分任务或畸形 payload 为 null。 */
export interface JobSceneSplitResult {
  /** 源视频总时长（秒） */
  duration: number;
  segments: Array<{
    /** 段序号（1 起） */
    segment_index: number;
    /** 段起点（秒） */
    start_time: number;
    /** 段终点（秒） */
    end_time: number;
    /** 段资产 id（对应 output_assets 里同 id 项） */
    segment_asset_id: string;
  }>;
}

/** GET /api/jobs/:id 返回（成功无 error；失败由 fetchJobStatus 补 error.msg） */
export interface JobDetail {
  job_id: number | string;
  status: JobStatus;
  /** 进度百分比 0-100 */
  progress: number;
  /** 产物信息，succeeded 时有值 */
  asset: JobAsset | null;
  /** 按 output_asset_ids 顺序的全量产出资源（场景切分扇出取段资产用，IKH8C1；其余任务缺省） */
  output_assets?: JobAsset[];
  /** 契约校验后的结果形态（场景切分：段起止与段资产 id，IKH8C1）；非场景切分任务或畸形 payload 为 null */
  result?: JobSceneSplitResult | null;
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

/** 音视频分离建任务（原「提取音频」一键直发，IKH28X 编辑态发送闭环复用）；
 *  音频占位节点与最终节点由前端写入画布快照。 */
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

/** 创建图片高清放大任务（IKGM9O）；免费口径同 media_extract——不带幂等头、无积分预估、不走余额拦截门。
 *  高清草稿卡已由前端本地建好（target_node_id 指向它），产物经 GET /api/jobs/:id 的 asset 回填。 */
export function createImageEnhancement(
  projectId: string,
  payload: CreateImageEnhancementPayload,
): Promise<ImageEnhancementCreatedData> {
  return apiRequest<ImageEnhancementCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-enhancements`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/** POST /api/projects/:id/image-erasures 请求体（键名与 backend/libs/contracts/image-erase.ts 契约恒等；
 *  按场景三键/四键，IKGOT4 创建入口 strict zod 复核）。
 *  涂抹遮罩 PNG 已先经 uploadAssetFile 落库（source=mask_erase，资产列表不可见）取得 mask_asset_id。 */
export type CreateImageErasePayload = ImageEraseInput;

/** 创建图片擦除任务返回（IKGOTB）；同高清放大：入队失败创建响应仍 200、任务随即 enqueue_failed 经轮询呈现。 */
export interface ImageEraseCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建图片擦除任务（IKGOTB）；免费口径同 image_enhance——不带幂等头、无积分预估、不走余额拦截门。
 *  擦除结果卡由前端在创建成功后本地插入（发送时才建卡，target_node_id 发送时生成传入），
 *  产物经 GET /api/jobs/:id 的 asset 按 target_node_id 回填。 */
export function createImageErase(
  projectId: string,
  payload: CreateImageErasePayload,
): Promise<ImageEraseCreatedData> {
  return apiRequest<ImageEraseCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-erasures`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/** POST /api/projects/:id/image-cutouts 请求体（键名与 backend/libs/contracts/image-cutout.ts 契约恒等；
 *  按场景三键/七键，创建入口 strict zod 复核；通用场景不携带描边与裁剪参数（接口会忽略的字段不进请求体））。 */
export type CreateImageCutoutPayload = ImageCutoutInput;

/** 创建图片抠图任务返回（IKGXLS）；同高清放大/擦除：入队失败创建响应仍 200、任务随即 enqueue_failed 经轮询呈现。 */
export interface ImageCutoutCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建图片抠图任务（IKGXLS）；免费口径同 image_enhance / image_erase——不带幂等头、无积分预估、不走余额拦截门。
 *  抠图结果卡由前端在创建成功后本地插入（发送时才建卡，target_node_id 发送时生成传入），
 *  产物经 GET /api/jobs/:id 的 asset 按 target_node_id 回填。 */
export function createImageCutout(
  projectId: string,
  payload: CreateImageCutoutPayload,
): Promise<ImageCutoutCreatedData> {
  return apiRequest<ImageCutoutCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-cutouts`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/** 创建智能扩图任务（IKGOR6）；免费口径同 media_extract / image_enhance——不带幂等头、
 *  无积分预估、不走余额拦截门。扩图结果卡已由前端本地建好（target_node_id 指向它），
 *  产物经 GET /api/jobs/:id 的 asset 回填（新分辨率随 asset 宽高回填结果卡）。 */
export function createImageOutpaint(
  projectId: string,
  payload: CreateImageOutpaintPayload,
): Promise<ImageOutpaintCreatedData> {
  return apiRequest<ImageOutpaintCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-outpaints`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/** POST /api/projects/:id/video-subtitle-erasures 请求体（四键，键名与
 *  backend/libs/contracts/video-subtitle-erase.ts 契约恒等；IKGZ80 创建入口 strict zod 复核：
 *  detect_mode 两值枚举、erase_boxes 空/≤20、框四键 ∈ [0,1] 归一化坐标）。 */
export type CreateVideoSubtitleErasePayload = VideoSubtitleEraseInput;

/** 创建视频去字幕任务返回（IKGZ83）；同高清放大/擦除/抠图：入队失败创建响应仍 200、
 *  任务随即 enqueue_failed 经轮询呈现。 */
export interface VideoSubtitleEraseCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建视频智能去字幕任务（IKGZ83）；免费口径同 image_enhance / image_erase / image_cutout
 *  ——不带幂等头、无积分预估、不走余额拦截门。去字幕结果卡由前端在创建成功后本地插入
 *  （发送时才建卡，target_node_id 发送时生成传入），产物经 GET /api/jobs/:id 的 asset
 *  按 target_node_id 回填（结果卡是普通视频素材卡，可再次去字幕）。 */
export function createVideoSubtitleErase(
  projectId: string,
  payload: CreateVideoSubtitleErasePayload,
): Promise<VideoSubtitleEraseCreatedData> {
  return apiRequest<VideoSubtitleEraseCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-subtitle-erasures`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/** POST /api/projects/:id/video-enhancements 请求体（三键，键名与
 *  backend/libs/contracts/video-enhance.ts 契约恒等；IKH3VE 创建入口 strict zod 复核：
 *  source_asset_id 数字串、target_node_id 非空、resolution ∈ 1080p/2k/4k）。 */
export type CreateVideoEnhancementPayload = VideoEnhanceInput;

/** 创建视频 HD 高清任务返回（IKH3VH）；同高清放大/去字幕：入队失败创建响应仍 200、
 *  任务随即 enqueue_failed 经轮询呈现。 */
export interface VideoEnhancementCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建视频 HD 高清任务（IKH3VH）；免费口径同 image_enhance / media_extract——不带幂等头、
 *  无积分预估、不走余额拦截门。HD 草稿卡已由前端本地建好（target_node_id 指向它），
 *  产物经 GET /api/jobs/:id 的 asset 回填。 */
export function createVideoEnhancement(
  projectId: string,
  payload: CreateVideoEnhancementPayload,
): Promise<VideoEnhancementCreatedData> {
  return apiRequest<VideoEnhancementCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-enhancements`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/** POST /api/projects/:id/video-scene-splits 请求体（四键，业务键名与
 *  backend/libs/contracts/video-scene-split.ts 契约恒等；IKH8BO 创建入口 strict 复核：
 *  source_asset_id 正整数字符串、target_node_id 非空（发送前本地建的占位卡节点 id）、
 *  granularity ∈ fine/standard/coarse；client_token 为幂等基础设施键（≤64 可打印 ASCII），
 *  每次发送、每次失败重试都新生成——同 token 只会重放旧任务，禁复用）。 */
export interface CreateVideoSceneSplitPayload {
  source_asset_id: string;
  target_node_id: string;
  granularity: VideoSceneSplitGranularity;
  client_token: string;
}

/** 创建视频场景切分任务返回（IKH8BR）；同家族：入队失败创建响应仍 200、
 *  任务随即 enqueue_failed 经轮询呈现。 */
export interface VideoSceneSplitCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建视频场景切分任务（IKH8BR）；免费口径同 image_enhance / media_extract——不带幂等头
 *  （幂等走 body 内 client_token）、无积分预估、不走余额拦截门。任务占位卡由前端在发送前
 *  本地建好（target_node_id 指向它），job_id 回写占位卡后经 GET /api/jobs/:id 轮询至终态
 *  （completed 分支的段卡扇出归 IKH8C1）。 */
export function createVideoSceneSplit(
  projectId: string,
  payload: CreateVideoSceneSplitPayload,
): Promise<VideoSceneSplitCreatedData> {
  return apiRequest<VideoSceneSplitCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-scene-splits`,
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
