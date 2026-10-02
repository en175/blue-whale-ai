/* ============================================
 * jobs 接口：生成任务创建/取消/重试/轮询/列表
 * 创建与重试需 Idempotency-Key（UUID）幂等头，**钥匙由调用方持有**（`./idempotencyKey` 铸造）：
 * 一次用户意图一把，重试复用同一把——否则服务端那套幂等（同键重放、只扣一次钱）形同虚设
 * ============================================ */
import { apiRequest, envelopeErrorCode, isApiError, silentInit, type ApiError } from './http';
import type { ImageEnhanceInput } from '@lib/contracts/image-enhance';
import type { ImageEraseInput } from '@lib/contracts/image-erase';
import type { ImageCutoutInput } from '@lib/contracts/image-cutout';
import type { ImageOutpaintInput } from '@lib/contracts/image-outpaint';
import type { VideoSubtitleEraseInput } from '@lib/contracts/video-subtitle-erase';
import type { VideoEnhanceInput } from '@lib/contracts/video-enhance';
import {
  VIDEO_FRAME_INTERPOLATION_INPUT_KEYS,
  VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT,
} from '@lib/contracts/video-frame-interpolation';
import type { VideoFrameInterpolationInput } from '@lib/contracts/video-frame-interpolation';
import type { MediaExtractOutputFormat } from '@lib/contracts/media-extract';
import type { AudioTrimInput } from '@lib/contracts/audio-trim';
import type { AudioMixCreate } from '@lib/contracts/audio-mix';
import type { AudioVideoMuxCreate } from '@lib/contracts/audio-video-mux';
import type { AudioSpeedInput } from '@lib/contracts/audio-speed';
import type { StageQuoteView, SampleRegenerateRequest, VideoFinalizeCreateRequest } from '@lib/contracts/video-sample-mode';
import type { VocalSplitInput, VocalSplitTrackType } from '@lib/contracts/vocal-split';
import type { VideoSceneSplitGranularity } from '@lib/contracts/video-scene-split';
import type {
  VideoMattingBackgroundColor,
  VideoMattingFormat,
  VideoMattingMode,
} from '@lib/contracts/video-matting';

/** 可由普通生成端点创建的任务类型（image_enhance / image_outpaint 走专属创建端点，不在此列） */
export type GenerationJobType = 'image' | 'video' | 'audio';

/** 通用任务查询可能返回媒体提取、高清放大、图片擦除、智能扩图、抠图、视频去字幕与
 *  音频截取任务（IKGM9O / IKGOT8 / IKGOR6 / IKGXLS / IKGZ83 / IKHB7A）。 */
export type JobType = GenerationJobType | 'media_extract' | 'image_enhance' | 'image_erase' | 'image_outpaint' | 'image_cutout' | 'video_subtitle_erase' | 'audio_trim' | 'audio_mix' | 'audio_video_mux' | 'video_frame_interpolation';

/** 任务状态：queued/processing 为进行中，succeeded/failed/cancelled 为终态；
 *  checking = 提交结果不明时的锁定态（契约 JOB_STATUS_CHECKING，IKIZQ5/QD）——不重提、不自动退款，
 *  轮询继续等核对定夺（明确成功恢复原任务 / 明确失败释放预扣）。 */
export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'checking';

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
 * - 轮询 GET /api/jobs/:id：失败已升到顶层 `{ code: 数值或字符串（IKJFGQ：字符串码优先）, msg: 中文 }`，由 fetchJobStatus 收敛到此
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
  /** IKIZQB：样片模式（契约 video-sample-mode.ts §1——仅参数增量）。true 时 resolution
   *  锁 480p、单输出，配套请求顶层携带 expected_credits + quote_revision（提交确认）。 */
  sample_mode?: true;
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
  /** IKIZQB：样片提交确认两字段（契约 confirmedSubmitFieldsSchema，parameters.sample_mode=true
   *  时必带）。取报价响应原样：服务端按同一规则复算，价格变化先刷新可见报价再由用户点击。 */
  expected_credits?: number;
  quote_revision?: string;
}

/** 生成任务参考项（图/视频/音频 references 契约） */
export interface GenerationRefItem {
  role: 'first_frame' | 'last_frame' | 'reference';
  type: 'image' | 'video' | 'audio';
  asset_id?: string;
  material_id?: string;
  /**
   * 来源素材的时长（秒，可选，ADR-0086）。
   *
   * ⚠️ 视频参考带上它**才划算得到价**：视频按 token 计费，而火山官方公式在「含视频输入」时
   * 要把**输入时长**加进 token 估算（(输入时长 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024）。
   * 服务端对本地素材会自己查 assets.duration 兜底；**素材库引用（material_id，本地零表）
   * 只能靠这里带**——不带就会因「含视频输入却量不到输入时长」被拒绝提交（不是按 0 估）。
   */
  duration?: number;
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

/** POST /api/projects/:id/vocal-splits 请求体（键名与 backend/libs/contracts/vocal-split.ts
 *  契约恒等；source_asset_id 恒传、scene/output_format 缺省后端补 audio/aac——与契约
 *  「冻结后三键恒在」的分工：请求体可选、创建入口补默认后冻结，IKHA2W 编辑态两参数恒显式携带）。 */
export interface CreateVocalSplitPayload {
  source_asset_id: string | number;
  scene?: VocalSplitInput['scene'];
  output_format?: VocalSplitInput['output_format'];
}

/** 创建人声背景分离任务返回（IKHA2W）；同音视频分离：入队失败创建响应仍 200、
 *  任务随即 enqueue_failed 经轮询呈现「任务入队失败，请重试」。 */
export interface VocalSplitCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建人声背景分离任务（IKHA2W）；免费口径同 media_extract——不带幂等头、无积分预估、
 *  不走余额拦截门。占位卡由前端在创建成功后本地插入，多轨产物扇出归 IKHA30。 */
export function createVocalSplit(
  projectId: string,
  payload: CreateVocalSplitPayload,
  init?: { silent?: boolean },
): Promise<VocalSplitCreatedData> {
  return apiRequest<VocalSplitCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/vocal-splits`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
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

/** 人声背景分离单轨结果投影（IKHA2J 定死的多轨形状，轨类型枚举与契约同源）；
 *  duration 后端投影可空（契约 VocalSplitTrackResult 为 number，传输面放宽为可空），
 *  回填轨卡时长时判空跳过。 */
export interface VocalSplitJobTrack {
  track_type: VocalSplitTrackType;
  asset_id: string;
  url: string;
  duration: number | null;
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
  /** 人声背景分离多轨结果（IKHA2J）：仅 vocal_split 任务 succeeded 时有值，轨序恒 =
   *  契约 VOCAL_SPLIT_SCENE_TRACKS[input.scene]（voice 恒首轨）；其余任务恒缺失。
   *  既有 asset 单对象仍在（回首轨），多轨消费走本字段。 */
  tracks?: VocalSplitJobTrack[] | null;
  /** 按 output_asset_ids 顺序的全量产出资源（场景切分扇出取段资产用，IKH8C1；其余任务缺省） */
  output_assets?: JobAsset[];
  /** 契约校验后的结果形态（场景切分：段起止与段资产 id，IKH8C1）；非场景切分任务或畸形 payload 为 null */
  result?: JobSceneSplitResult | null;
  /** 文本输入签名投影（IKFM3S）：succeeded 时前端回写目标节点 usedInputSignature；无则 null */
  text_input_signature?: string | null;
  /** IKIZQB：两阶段视频投影增量（契约 videoStageJobProjectionSchema）。旧任务/普通视频
   *  缺省按普通视频处理（video_stage=video、来源与截止 null）。 */
  video_stage?: 'video' | 'sample' | 'final';
  /** 成片任务指向来源样片任务（仅 final 阶段非 null；IKIZQ8/QH 投影）。 */
  source_sample_job_id?: string | null;
  /** 样片任务指向其唯一成片任务（仅 sample 阶段可非 null；IKIZQ8/QH 投影）。 */
  final_job_id?: string | null;
  /** 样片的实际转成片截止时间（RFC3339）；null = 缺可信上游 created_at（禁用成片，样片保留）。 */
  finalize_deadline_at?: string | null;
  /** 阶段费用状态（契约 chargeStateSchema，按阶段独立）：held 已预扣 / settled 已按真实用量结算 /
   *  released 该阶段失败预扣已释放；旧任务/普通视频为 null。 */
  charge_state?: 'held' | 'settled' | 'released' | null;
  /** 按真实用量结算的实际积分（settled 后非 null）；旧任务/普通视频为 null。 */
  actual_credits?: number | null;
  error?: JobError | null;
}

/** GET /api/jobs 列表项 */
export interface JobRecord {
  job_id: number | string;
  type: JobType;
  status: JobStatus;
  progress: number;
  input: unknown;
  created_at: string;
  output_assets: JobAsset[];
  error?: JobError | null;
  canvas_card_state?: 'pending' | 'present' | 'removed';
  /** IKIZQB：两阶段视频投影增量（同 JobDetail；列表投影契约同一 schema，IKIZQ8/QH 补齐
   *  来源/费用字段——历史页据此显示阶段、来源与各阶段费用）。 */
  video_stage?: 'video' | 'sample' | 'final';
  source_sample_job_id?: string | null;
  final_job_id?: string | null;
  finalize_deadline_at?: string | null;
  charge_state?: 'held' | 'settled' | 'released' | null;
  actual_credits?: number | null;
}

/** GET /api/jobs 返回 */
export interface JobListData {
  records: JobRecord[];
  total: number;
  size: number;
  current: number;
}

/** 创建生成任务。`idempotencyKey` 由**调用方**在发起那一刻造好并持有（`./idempotencyKey`）：
 *  同一次用户意图（双击、响应丢了原样重发、401 登录后续跑）必须复用同一把，服务端才
 *  会重放首次结果——只建一个 job、只扣一次钱；同键异载荷服务端判 409。 */
export function createGenerationJob(
  projectId: string,
  payload: CreateJobPayload,
  idempotencyKey: string,
): Promise<JobCreatedData> {
  return apiRequest<JobCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    },
  );
}

/** 音视频分离建任务（原「提取音频」一键直发，IKH28X 编辑态发送闭环复用）；
 *  音频占位节点与最终节点由前端写入画布快照。 */
export function createMediaExtraction(
  projectId: string,
  payload: CreateMediaExtractionPayload,
  init?: { silent?: boolean },
): Promise<MediaExtractionCreatedData> {
  return apiRequest<MediaExtractionCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/media-extractions`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
}

/** POST /api/projects/:id/audio-trims 请求体（四键，键名与 backend/libs/contracts/audio-trim.ts
 *  契约恒等；IKHB6N 创建入口 strict zod 复核：source_asset_id 数字串、start_time/end_time
 *  可选（贴边省略口径，选区贴 0/贴全长不传）、output_format 五枚举）。 */
export type CreateAudioTrimPayload = AudioTrimInput;

/** 创建音频截取任务返回（IKHB7A）；免费口径同 media_extract——不带幂等头、无积分预估、
 *  不走余额拦截门。截取占位卡由前端在创建成功后本地插入（源音频卡右侧 +60px），
 *  产物经 GET /api/jobs/:id 的 asset 回填（duration 以火山返回为权威时长）。 */
export interface AudioTrimCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建音频截取任务（IKHB7A，编辑态发送闭环）。
 *  init.silent 透传 apiRequest（IKI8L4 错误提示归属）：静默传输失败仍抛 ApiError
 *  但 http 层不 toast，由持有发送身份的页面 catch 统一提示一次（先例 createAudioSpeed）。 */
export function createAudioTrim(
  projectId: string,
  payload: CreateAudioTrimPayload,
  init?: { silent?: boolean },
): Promise<AudioTrimCreatedData> {
  return apiRequest<AudioTrimCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/audio-trims`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
}

/** 业务 API 接受后返回任务 id；画布结果卡在受理后创建。 */
export function createAudioMix(
  projectId: string,
  payload: AudioMixCreate,
  init: { idempotencyKey: string; silent?: boolean },
): Promise<AudioTrimCreatedData> {
  return apiRequest<AudioTrimCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/audio-mixes`,
    { method: 'POST', headers: { 'Idempotency-Key': init.idempotencyKey }, body: JSON.stringify(payload),
      ...silentInit(init) },
  );
}

/** 使用服务端冻结输入重试同一音频混合任务；调用方为一次重试尝试保留同一个幂等键。 */
export function retryAudioMix(
  projectId: string,
  jobId: string | number,
  idempotencyKey: string,
  init?: { silent?: boolean },
): Promise<{ job_id: string; status: JobStatus; replayed: boolean }> {
  return apiRequest(
    `/api/projects/${encodeURIComponent(projectId)}/audio-mixes/${encodeURIComponent(String(jobId))}/retry`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      ...silentInit(init) },
  );
}

/** POST /api/projects/:id/audio-video-muxes 请求体（IKIHPJ 契约恒等：冻结快照
 *  { audio: {assetId,nodeId}, video: {assetId,nodeId?}, is_audio_reserve, sync }——
 *  对象内 camel、顶层 snake 各就各位，web 不各自拼键，直接用契约类型）。 */
export type CreateAudioVideoMuxPayload = AudioVideoMuxCreate;

/** 创建音视频合成任务返回（IKIHPJ）：业务 API 受理后回 jobId 并标记需入队；
 *  免费任务无积分预估、不走余额拦截门。占位卡由草稿卡原地转生成中（不新建卡/线），
 *  产物经 GET /api/jobs/:id 的 asset 回填。 */
export interface AudioVideoMuxCreatedData {
  job_id: string;
  status: 'queued';
  enqueue_required?: boolean;
}

/** 创建音视频合成任务（IKIHPL 发送闭环）。
 *  init.silent 透传 apiRequest（错误提示归属同 createAudioMix）：静默传输失败仍抛
 *  ApiError 但 http 层不 toast，由持有发送身份的页面 catch 统一提示一次。 */
export function createAudioVideoMux(
  projectId: string,
  payload: AudioVideoMuxCreate,
  init: { idempotencyKey: string; silent?: boolean },
): Promise<AudioVideoMuxCreatedData> {
  return apiRequest<AudioVideoMuxCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/audio-video-muxes`,
    { method: 'POST', headers: { 'Idempotency-Key': init.idempotencyKey }, body: JSON.stringify(payload),
      ...silentInit(init) },
  );
}

/** 使用服务端冻结输入重试同一音视频合成任务（IKIHPL `:jobId/retry`）；必带 Idempotency-Key
 *  （1–128 可打印非空白，服务端 PARAM_MISSING 拒绝空键），调用方为一次重试尝试保留同一个
 *  幂等键——双击/状态未知后重发沿用同键，服务端按 command_idempotency 重放。 */
export function retryAudioVideoMux(
  projectId: string,
  jobId: string | number,
  idempotencyKey: string,
  init?: { silent?: boolean },
): Promise<{ job_id: string; status: JobStatus; replayed: boolean }> {
  return apiRequest(
    `/api/projects/${encodeURIComponent(projectId)}/audio-video-muxes/${encodeURIComponent(String(jobId))}/retry`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      ...silentInit(init) },
  );
}

/** POST /api/projects/:id/audio-speeds 请求体（键名与 backend/libs/contracts/audio-speed.ts
 *  契约恒等；source_asset_id 必传、speed 可选——贴原速省略口径，1.0 不传走官方默认；
 *  构造走契约 buildAudioSpeedInput 单源，web 不各自拼键）。 */
export type CreateAudioSpeedPayload = AudioSpeedInput;

/** 创建音频调速任务返回（IKHW5S）；免费口径同 media_extract——不带幂等头、无积分预估、
 *  不走余额拦截门。调速占位卡由前端在创建成功后本地插入（源音频卡右侧 +60px），
 *  产物经 GET /api/jobs/:id 的 asset 回填（duration 以火山返回为权威时长）。 */
export interface AudioSpeedCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建音频调速任务（IKHW5S，编辑态发送闭环）。
 *  init.silent 透传 apiRequest（IKI4LX「请求错误只提示一次」，同 createFrameInterpolation
 *  先例）：静默传输失败仍抛 ApiError 但 http 层不 toast，由调用方 catch 统一提示一次。 */
export function createAudioSpeed(
  projectId: string,
  payload: CreateAudioSpeedPayload,
  init?: { silent?: boolean },
): Promise<AudioSpeedCreatedData> {
  return apiRequest<AudioSpeedCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/audio-speeds`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
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
  init?: { silent?: boolean },
): Promise<ImageEraseCreatedData> {
  return apiRequest<ImageEraseCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-erasures`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
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
  init?: { silent?: boolean },
): Promise<ImageCutoutCreatedData> {
  return apiRequest<ImageCutoutCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-cutouts`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
}

/** 创建智能扩图任务（IKGOR6）；免费口径同 media_extract / image_enhance——不带幂等头、
 *  无积分预估、不走余额拦截门。扩图结果卡已由前端本地建好（target_node_id 指向它），
 *  产物经 GET /api/jobs/:id 的 asset 回填（新分辨率随 asset 宽高回填结果卡）。 */
export function createImageOutpaint(
  projectId: string,
  payload: CreateImageOutpaintPayload,
  opts?: { silent?: boolean },
): Promise<ImageOutpaintCreatedData> {
  return apiRequest<ImageOutpaintCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-outpaints`,
    {
      silent: opts?.silent,
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
  init?: { silent?: boolean },
): Promise<VideoSubtitleEraseCreatedData> {
  return apiRequest<VideoSubtitleEraseCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-subtitle-erasures`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
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

/** POST /api/projects/:id/video-frame-interpolations 请求体（三键，键名与
 *  backend/libs/contracts/video-frame-interpolation.ts 契约恒等；IKHLK3 创建入口 strict zod 复核：
 *  source_asset_id 正整数字符串、target_node_id 非空、fps ∈ 30/60/120 **整型直传**）。 */
export type CreateFrameInterpolationPayload = VideoFrameInterpolationInput;

/** 创建视频插帧任务返回（IKHLK3）；同 HD 高清：入队失败创建响应仍 200、
 *  任务随即 enqueue_failed 经轮询呈现。 */
export interface FrameInterpolationCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建视频插帧任务（IKHLK3 端点；免费口径同 HD 高清 / 去字幕——不带幂等头、
 *  无 body 内 client_token、无积分预估、不走余额拦截门）。
 *  插帧草稿卡已由前端本地建好（target_node_id 指向它），产物经 GET /api/jobs/:id 的 asset 回填。
 *  init.silent 透传 apiRequest（IKHSFH「请求错误只提示一次」）：静默传输失败仍抛 ApiError
 *  但 http 层不 toast，由调用方 catch 统一提示一次（先例 createConversationQuote）。 */
export function createFrameInterpolation(
  projectId: string,
  payload: CreateFrameInterpolationPayload,
  init?: { silent?: boolean },
): Promise<FrameInterpolationCreatedData> {
  return apiRequest<FrameInterpolationCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-frame-interpolations`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
}

/** GET /api/projects/:projectId/video-frame-interpolations/current 返回（IKHSFE 恢复契约）：
 *  键名与契约 VIDEO_FRAME_INTERPOLATION_RECOVERY_RESPONSE_KEYS 恒等；目标节点无任何关联任务时
 *  data 为 null（不另设空对象形态）。响应不含 input（凭证不外泄），成品/失败详情走
 *  GET /api/jobs/:id。status 不过滤——failed / cancelled 也能查回（前端决定是否复活轮询）。 */
export interface FrameInterpolationCurrentData {
  /** 当前关联任务 id（同节点多历史任务按 gmt_create/id 降序取最新） */
  job_id: string;
  /** 任务状态（generation_jobs.status 原值） */
  status: JobStatus;
  /** 进度百分比原值（终态恒 0 或 100） */
  progress: number;
  /** 创建时间 ISO 串 */
  created_at: string;
}

/** 查询目标节点当前关联的插帧任务（IKHSFE 恢复契约；路由段与查询键均契约同源）：
 *  浏览器未收到创建响应就关页时，前端只持有草稿卡的 target_node_id（本地生成），
 *  服务端按「同 user + 同 project + 同 target_node_id 的未软删任务取最新」查回当前关联，
 *  供重新进入画布恢复原卡与任务（IKHSFF 关页恢复闭环）。 */
export function fetchFrameInterpolationCurrent(
  projectId: string,
  targetNodeId: string,
): Promise<FrameInterpolationCurrentData | null> {
  return apiRequest<FrameInterpolationCurrentData | null>(
    `/api/projects/${encodeURIComponent(projectId)}/video-frame-interpolations/${VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT}` +
      `?${VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId}=${encodeURIComponent(targetNodeId)}`,
    { silent: true },
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
 *  （completed 分支的段卡扇出归 IKH8C1）。
 *  init.silent 透传 apiRequest（IKI8L4 错误提示归属）：发送即同步退会话，失败提示由页面
 *  catch 按「退出后捕获纪元」单源提示（无后来会话不吞、有后来会话不扰），先例 createAudioSpeed。 */
export function createVideoSceneSplit(
  projectId: string,
  payload: CreateVideoSceneSplitPayload,
  init?: { silent?: boolean },
): Promise<VideoSceneSplitCreatedData> {
  return apiRequest<VideoSceneSplitCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-scene-splits`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
}

/** POST /api/projects/:id/video-mattings 请求体（IKHK9N，键名与 backend/libs/contracts/
 *  video-matting.ts 契约恒等；IKHK98 创建入口 strict 复核：source_asset_id 正整数字符串、
 *  target_node_id 非空（发送前本地建的占位卡节点 id）、mode ∈ portrait/greenscreen（必填
 *  无默认，入口下拉直选）、format ∈ WEBM/MP4（缺省补 WEBM）、background_color 仅 MP4
 *  （缺省补 white；WEBM 传即拒——前端按 buildSmartMattingInput 保证 WEBM 形态恒无该键）；
 *  client_token 为幂等基础设施键（≤64 可打印 ASCII），每次发送、每次失败重试都新生成
 *  ——同 token 只会重放旧任务，禁复用。 */
export interface CreateVideoMattingPayload {
  source_asset_id: string;
  target_node_id: string;
  mode: VideoMattingMode;
  format: VideoMattingFormat;
  background_color?: VideoMattingBackgroundColor;
  client_token: string;
}

/** 创建视频智能抠像任务返回（IKHK9N）；同家族：入队失败创建响应仍 200、
 *  任务随即 enqueue_failed 经轮询呈现。 */
export interface VideoMattingCreatedData {
  job_id: string;
  status: 'queued';
}

/** 创建视频智能抠像任务（IKHK9N）；免费口径同 image_enhance / media_extract / 场景切分
 *  ——不带幂等头（幂等走 body 内 client_token）、无积分预估、不走余额拦截门。任务占位卡
 *  由前端在发送前本地建好（target_node_id 指向它），job_id 回写占位卡后经 GET /api/jobs/:id
 *  轮询至终态（succeeded 成品卡回填归 IKHKAC，failed 占位卡按冻结 input 原参数重试）。
 *  编辑提交传 silent，由工具会话运行时按归属反馈；失败卡重试默认由 HTTP 层提示一次。 */
export function createVideoMatting(
  projectId: string,
  payload: CreateVideoMattingPayload,
  opts?: { silent?: boolean },
): Promise<VideoMattingCreatedData> {
  return apiRequest<VideoMattingCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-mattings`,
    {
      silent: opts?.silent,
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

/** 重试终态失败任务：为缺失/失败输出创建新任务。
 *  `idempotencyKey` 由调用方持有，口径同 {@link createGenerationJob}——「重试」是同一张卡
 *  上的同一次意图（响应丢了再点一次不该变成两笔钱），受理成功后才作废这把钥匙。 */
export function retryGenerationJob(
  projectId: string,
  jobId: number | string,
  idempotencyKey: string,
): Promise<JobCreatedData> {
  return apiRequest<JobCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/${jobId}/retry`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

/** 成片报价视图：契约 StageQuoteView（jobs 模块内联重导出，避免调用方多引一个报价模块）。 */
export type VideoFinalizeQuote = StageQuoteView;

/** POST /api/projects/:projectId/generation-jobs/:jobId/finalize/quote（IKIZQC）。
 *  只读、fail open：样片身份/成功/转存/截止/唯一尝试任一不满足或算不出价 → 空报价
 *  双 null（前端据此禁用成片按钮——「无报价不提交」）。`jobId` 是本仓样片任务 ID，
 *  请求体恒为空对象（契约 videoFinalizeQuoteRequestSchema）。 */
export function quoteVideoFinalize(
  projectId: string,
  jobId: string | number,
  init?: { silent?: boolean },
): Promise<VideoFinalizeQuote> {
  return apiRequest<VideoFinalizeQuote>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/${encodeURIComponent(String(jobId))}/finalize/quote`,
    {
      method: 'POST',
      body: JSON.stringify({}),
      ...silentInit(init),
    },
  );
}

/** POST /api/projects/:projectId/generation-jobs/:jobId/finalize（IKIZQC）。
 *  成片提交：请求体仅报价确认两字段（契约 videoFinalizeCreateRequestSchema——浏览器不
 *  重放上游输入，服务端从样片冻结输入派生 1080p 任务）。`idempotencyKey` 口径同
 *  {@link createGenerationJob}：一次用户意图一把，响应丢失原样重发复用同键由服务端重放，
 *  双击/两页并发由来源唯一约束兜底（1057 至多一条成片任务与一笔预扣）。错误码：
 *  1056 变价重报价、1057 已有成片尝试、1058 过期或缺可信截止、1014 核对中拒再提交。 */
export function finalizeVideoJob(
  projectId: string,
  jobId: string | number,
  payload: VideoFinalizeCreateRequest,
  idempotencyKey: string,
  init?: { silent?: boolean },
): Promise<JobCreatedData> {
  return apiRequest<JobCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/${encodeURIComponent(String(jobId))}/finalize`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
}

/** POST /api/projects/:projectId/generation-jobs/:jobId/regenerate-sample/quote（IKIZQF）。
 *  重新生成样片报价（只读、fail open）：非样片任务 / 模型停用或未放行 / 算不出价 → 空报价
 *  双 null（前端据此禁用重新生成按钮——无报价不提交）。过期与成片失败**不影响**报价。
 *  `jobId` 是本仓原样片任务 ID；请求体恒为空对象（契约 §5，输入由服务端从冻结输入派生）。 */
export function quoteSampleRegenerate(
  projectId: string,
  jobId: string | number,
  init?: { silent?: boolean },
): Promise<VideoFinalizeQuote> {
  return apiRequest<VideoFinalizeQuote>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/${encodeURIComponent(String(jobId))}/regenerate-sample/quote`,
    {
      method: 'POST',
      body: JSON.stringify({}),
      ...silentInit(init),
    },
  );
}

/** POST /api/projects/:projectId/generation-jobs/:jobId/regenerate-sample（IKIZQF）。
 *  重新生成样片提交：从原样片**冻结输入**派生创建请求走创建管线，新建任务与结果卡
 *  （不继承旧报价、旧截止或 Draft ID）。请求体仅报价确认两字段（契约
 *  sampleRegenerateRequestSchema——浏览器不重传输入）。`idempotencyKey` 口径同
 *  {@link createGenerationJob}：一次用户意图一把，报价变动即换新意图换新键（同键异载荷
 *  服务端判幂等冲突 100409）。错误码：1056 变价重报价、1014 核对中拒再提交。 */
export function regenerateSampleJob(
  projectId: string,
  jobId: string | number,
  payload: SampleRegenerateRequest,
  idempotencyKey: string,
  init?: { silent?: boolean },
): Promise<JobCreatedData> {
  return apiRequest<JobCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/${encodeURIComponent(String(jobId))}/regenerate-sample`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
      ...silentInit(init),
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
        error: { code: envelopeErrorCode(e), msg: e.message },
      };
    }
    throw e;
  }
}

/** GET /api/jobs 查询参数 */
export interface FetchJobsParams {
  projectId?: string;
  type?: JobType;
  status?: JobStatus;
  size?: number;
  /** 批量查询指定任务ID */
  ids?: (number | string)[];
  page?: number;
}

/** 列出任务 GET /api/jobs（画布水合恢复时按状态批量查询） */
export function fetchJobs(params: FetchJobsParams = {}, init?: { silent?: boolean }) {
  const qs = new URLSearchParams();
  if (params.projectId) qs.set('projectId', params.projectId);
  if (params.type) qs.set('type', params.type);
  if (params.status) qs.set('status', params.status);
  if (params.size !== undefined) qs.set('size', String(params.size));
  if (params.ids?.length) qs.set('ids', params.ids.join(','));
  if (params.page !== undefined) qs.set('page', String(params.page));
  const suffix = qs.toString();
  return apiRequest<JobListData>(`/api/jobs${suffix ? `?${suffix}` : ''}`, init);
}
