import { apiRequest, envelopeErrorCode, isApiError, silentInit, type ApiError } from '@/api/http';
import type { CanvasBinding } from './canvasRecovery';
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

export type GenerationJobType = 'image' | 'video' | 'audio';

export type JobType = GenerationJobType | 'media_extract' | 'image_enhance' | 'image_erase' | 'image_outpaint' | 'image_cutout' | 'video_subtitle_erase' | 'video_enhance' | 'vocal_split' | 'video_scene_split' | 'audio_trim' | 'audio_mix' | 'audio_video_mux' | 'audio_speed' | 'video_frame_interpolation' | 'video_matting';

export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'checking';

export interface JobAsset {
  id: string;
  url: string;
  type: GenerationJobType;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

export interface JobError {
  code: number | string;
  msg?: string;
  message?: string;
}

export const GENERATION_DOMAIN_CODE_MIN = 1000;
export const GENERATION_DOMAIN_CODE_MAX = 1099;

export function isGenerationDomainError(e: unknown): e is ApiError {
  if (!isApiError(e)) return false;
  const n = typeof e.code === 'number' ? e.code : Number(e.code);
  return Number.isInteger(n) && n >= GENERATION_DOMAIN_CODE_MIN && n <= GENERATION_DOMAIN_CODE_MAX;
}

export function readJobFailText(
  error?: { msg?: string | null; message?: string | null } | null,
): string {
  for (const value of [error?.msg, error?.message]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export interface ImageJobParameters {
  prompt: string;
  model_id: string;
  aspect_ratio: string;
  size: string;
  web_search?: boolean;
  sequential_image_generation?: boolean;
}

export interface VideoJobParameters {
  prompt: string;
  model_id: string;
  aspect_ratio: string;
  resolution: string;
  duration: number;
  generate_audio?: boolean;
  sample_mode?: true;
  mode?: string;
}

export interface AudioJobParameters {
  prompt: string;
  model_id: string;
}

export interface CreateJobPayload {
  type: GenerationJobType;
  input_asset_ids?: (string | number)[];
  expected_output_count: number;
  parameters: ImageJobParameters | VideoJobParameters | AudioJobParameters;
  first_frame_asset_id?: number | string;
  last_frame_asset_id?: number | string;
  reference_asset_ids?: (number | string)[];
  first_frame_material_id?: string;
  last_frame_material_id?: string;
  reference_materials?: Array<{ id: string; type: 'image' | 'video' }>;
  references?: GenerationRefItem[];
  target_node_id?: string;
  expected_credits?: number;
  quote_revision?: string;
  canvas_binding?: unknown;
}

export interface GenerationRefItem {
  role: 'first_frame' | 'last_frame' | 'reference';
  type: 'image' | 'video' | 'audio';
  asset_id?: string;
  material_id?: string;
  duration?: number;
}

export interface JobCreatedData {
  generation_job_id: string;
  cursor: number;
}

export interface CreateMediaExtractionPayload {
  source_asset_id: string | number;
  output_format?: MediaExtractOutputFormat;
}

export interface MediaExtractionCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: MediaToolCanvasBindingView;
}

export interface CreateVocalSplitPayload {
  source_asset_id: string | number;
  scene?: VocalSplitInput['scene'];
  output_format?: VocalSplitInput['output_format'];
  canvas_binding?: unknown;
}

export interface VocalSplitCreatedData {
  job_id: string;
  status: 'queued';
}

export function createVocalSplit(
  projectId: string,
  payload: CreateVocalSplitPayload,
  init?: { silent?: boolean; idempotencyKey?: string },
): Promise<VocalSplitCreatedData> {
  return apiRequest<VocalSplitCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/vocal-splits`,
    {
      method: 'POST',
      ...(init?.idempotencyKey ? { headers: { 'Idempotency-Key': init.idempotencyKey } } : {}),
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
}

export type CreateImageEnhancementPayload = ImageEnhanceInput;

export interface ImageToolBindingView {
  protocol_version: 1;
  submission_id: string;
  target_node_id: string;
  binding_revision: number;
  job_id: string;
  is_current: boolean;
}

export interface ImageToolCreateInit {
  silent?: boolean;
  canvasBinding?: CanvasBinding | null;
  idempotencyKey?: string;
}

function imageToolRequestBody(payload: Record<string, unknown>, init?: ImageToolCreateInit) {
  return JSON.stringify(init?.canvasBinding ? { ...payload, canvas_binding: init.canvasBinding } : payload);
}

function imageToolRequestHeaders(init?: ImageToolCreateInit): Record<string, string> | undefined {
  return init?.canvasBinding && init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : undefined;
}

export interface ImageEnhancementCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: ImageToolBindingView;
}

export type CreateImageOutpaintPayload = ImageOutpaintInput;

export interface ImageOutpaintCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: ImageToolBindingView;
}

export interface VocalSplitJobTrack {
  track_type: VocalSplitTrackType;
  asset_id: string;
  url: string;
  duration: number | null;
}

export interface JobSceneSplitResult {
  duration: number;
  segments: Array<{
    segment_index: number;
    start_time: number;
    end_time: number;
    segment_asset_id: string;
  }>;
}

export interface JobDetail {
  job_id: number | string;
  status: JobStatus;
  progress: number;
  asset: JobAsset | null;
  tracks?: VocalSplitJobTrack[] | null;
  output_assets?: JobAsset[];
  result?: JobSceneSplitResult | null;
  text_input_signature?: string | null;
  video_stage?: 'video' | 'sample' | 'final';
  source_sample_job_id?: string | null;
  final_job_id?: string | null;
  finalize_deadline_at?: string | null;
  charge_state?: 'held' | 'settled' | 'released' | null;
  actual_credits?: number | null;
  error?: JobError | null;
}

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
  video_stage?: 'video' | 'sample' | 'final';
  source_sample_job_id?: string | null;
  final_job_id?: string | null;
  finalize_deadline_at?: string | null;
  charge_state?: 'held' | 'settled' | 'released' | null;
  actual_credits?: number | null;
}

export interface JobListData {
  records: JobRecord[];
  total: number;
  size: number;
  current: number;
}

export interface MediaToolCanvasBindingView {
  protocol_version: number;
  submission_id: string;
  target_node_id: string;
  binding_revision: number;
  job_id: string;
  is_current: boolean;
}

interface MediaToolCreateRecoveryInit {
  silent?: boolean;
  canvasBinding?: unknown;
  idempotencyKey?: string;
}

function withRecoveryBinding(
  payload: unknown,
  init?: { canvasBinding?: unknown; idempotencyKey?: string },
): { method: 'POST'; headers?: Record<string, string>; body: string } {
  return {
    method: 'POST',
    ...(init?.idempotencyKey ? { headers: { 'Idempotency-Key': init.idempotencyKey } } : {}),
    body: JSON.stringify(init?.canvasBinding != null ? { ...(payload as object), canvas_binding: init.canvasBinding } : payload),
  };
}

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

export function createMediaExtraction(
  projectId: string,
  payload: CreateMediaExtractionPayload,
  init?: MediaToolCreateRecoveryInit,
): Promise<MediaExtractionCreatedData> {
  return apiRequest<MediaExtractionCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/media-extractions`,
    {
      ...withRecoveryBinding(payload, init),
      ...silentInit(init),
    },
  );
}

export type CreateAudioTrimPayload = AudioTrimInput;

export interface AudioTrimCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: MediaToolCanvasBindingView;
}

export function createAudioTrim(
  projectId: string,
  payload: CreateAudioTrimPayload,
  init?: MediaToolCreateRecoveryInit,
): Promise<AudioTrimCreatedData> {
  return apiRequest<AudioTrimCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/audio-trims`,
    {
      ...withRecoveryBinding(payload, init),
      ...silentInit(init),
    },
  );
}

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

export interface DedicatedRetryCreatedData {
  job_id: string;
  status: JobStatus;
  replayed: boolean;
  canvas_binding?: {
    protocol_version: number;
    submission_id: string;
    target_node_id: string;
    binding_revision: number;
    job_id: string;
    is_current: boolean;
  };
}

export function retryAudioMix(
  projectId: string,
  jobId: string | number,
  idempotencyKey: string,
  init?: { silent?: boolean },
  canvasBinding?: unknown,
): Promise<DedicatedRetryCreatedData> {
  return apiRequest<DedicatedRetryCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/audio-mixes/${encodeURIComponent(String(jobId))}/retry`,
    {
      method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      ...(canvasBinding ? { body: JSON.stringify({ canvas_binding: canvasBinding }) } : {}),
      ...silentInit(init),
    },
  );
}

export type CreateAudioVideoMuxPayload = AudioVideoMuxCreate;

export interface AudioVideoMuxCreatedData {
  job_id: string;
  status: 'queued';
  enqueue_required?: boolean;
}

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

export function retryAudioVideoMux(
  projectId: string,
  jobId: string | number,
  idempotencyKey: string,
  init?: { silent?: boolean },
  canvasBinding?: unknown,
): Promise<DedicatedRetryCreatedData> {
  return apiRequest<DedicatedRetryCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/audio-video-muxes/${encodeURIComponent(String(jobId))}/retry`,
    {
      method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      ...(canvasBinding ? { body: JSON.stringify({ canvas_binding: canvasBinding }) } : {}),
      ...silentInit(init),
    },
  );
}

export type CreateAudioSpeedPayload = AudioSpeedInput;

export interface AudioSpeedCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: MediaToolCanvasBindingView;
}

export function createAudioSpeed(
  projectId: string,
  payload: CreateAudioSpeedPayload,
  init?: MediaToolCreateRecoveryInit,
): Promise<AudioSpeedCreatedData> {
  return apiRequest<AudioSpeedCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/audio-speeds`,
    {
      ...withRecoveryBinding(payload, init),
      ...silentInit(init),
    },
  );
}

export function createImageEnhancement(
  projectId: string,
  payload: CreateImageEnhancementPayload,
  init?: ImageToolCreateInit,
): Promise<ImageEnhancementCreatedData> {
  return apiRequest<ImageEnhancementCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-enhancements`,
    {
      method: 'POST',
      headers: imageToolRequestHeaders(init),
      body: imageToolRequestBody(payload, init),
      ...silentInit(init),
    },
  );
}

export type CreateImageErasePayload = ImageEraseInput;

export interface ImageEraseCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: ImageToolBindingView;
}

export function createImageErase(
  projectId: string,
  payload: CreateImageErasePayload,
  init?: ImageToolCreateInit,
): Promise<ImageEraseCreatedData> {
  return apiRequest<ImageEraseCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-erasures`,
    {
      method: 'POST',
      headers: imageToolRequestHeaders(init),
      body: imageToolRequestBody(payload, init),
      ...silentInit(init),
    },
  );
}

export type CreateImageCutoutPayload = ImageCutoutInput;

export interface ImageCutoutCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: ImageToolBindingView;
}

export function createImageCutout(
  projectId: string,
  payload: CreateImageCutoutPayload,
  init?: ImageToolCreateInit,
): Promise<ImageCutoutCreatedData> {
  return apiRequest<ImageCutoutCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-cutouts`,
    {
      method: 'POST',
      headers: imageToolRequestHeaders(init),
      body: imageToolRequestBody(payload, init),
      ...silentInit(init),
    },
  );
}

export function createImageOutpaint(
  projectId: string,
  payload: CreateImageOutpaintPayload,
  init?: ImageToolCreateInit,
): Promise<ImageOutpaintCreatedData> {
  return apiRequest<ImageOutpaintCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/image-outpaints`,
    {
      silent: init?.silent,
      method: 'POST',
      headers: imageToolRequestHeaders(init),
      body: imageToolRequestBody(payload, init),
    },
  );
}

export type CreateVideoSubtitleErasePayload = VideoSubtitleEraseInput;

export interface VideoSubtitleEraseCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: MediaToolCanvasBindingView;
}

export function createVideoSubtitleErase(
  projectId: string,
  payload: CreateVideoSubtitleErasePayload,
  init?: MediaToolCreateRecoveryInit,
): Promise<VideoSubtitleEraseCreatedData> {
  return apiRequest<VideoSubtitleEraseCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-subtitle-erasures`,
    {
      ...withRecoveryBinding(payload, init),
      ...silentInit(init),
    },
  );
}

export type CreateVideoEnhancementPayload = VideoEnhanceInput;

export interface VideoEnhancementCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: MediaToolCanvasBindingView;
}

export function createVideoEnhancement(
  projectId: string,
  payload: CreateVideoEnhancementPayload,
  init?: MediaToolCreateRecoveryInit,
): Promise<VideoEnhancementCreatedData> {
  return apiRequest<VideoEnhancementCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-enhancements`,
    {
      ...withRecoveryBinding(payload, init),
      ...silentInit(init),
    },
  );
}

export type CreateFrameInterpolationPayload = VideoFrameInterpolationInput;

export interface FrameInterpolationCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: MediaToolCanvasBindingView;
}

export function createFrameInterpolation(
  projectId: string,
  payload: CreateFrameInterpolationPayload,
  init?: MediaToolCreateRecoveryInit,
): Promise<FrameInterpolationCreatedData> {
  return apiRequest<FrameInterpolationCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-frame-interpolations`,
    {
      ...withRecoveryBinding(payload, init),
      ...silentInit(init),
    },
  );
}

export interface FrameInterpolationCurrentData {
  job_id: string;
  status: JobStatus;
  progress: number;
  created_at: string;
}

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

export interface CreateVideoSceneSplitPayload {
  source_asset_id: string;
  target_node_id: string;
  granularity: VideoSceneSplitGranularity;
  client_token: string;
  canvas_binding?: unknown;
}

export interface VideoSceneSplitCreatedData {
  job_id: string;
  status: 'queued';
}

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

export interface CreateVideoMattingPayload {
  source_asset_id: string;
  target_node_id: string;
  mode: VideoMattingMode;
  format: VideoMattingFormat;
  background_color?: VideoMattingBackgroundColor;
  client_token: string;
}

export interface VideoMattingCreatedData {
  job_id: string;
  status: 'queued';
  canvas_binding?: MediaToolCanvasBindingView;
}

export function createVideoMatting(
  projectId: string,
  payload: CreateVideoMattingPayload,
  init?: MediaToolCreateRecoveryInit,
): Promise<VideoMattingCreatedData> {
  return apiRequest<VideoMattingCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/video-mattings`,
    {
      ...withRecoveryBinding(payload, init),
      silent: init?.silent,
    },
  );
}

export function cancelGenerationJob(projectId: string, jobId: number | string) {
  return apiRequest<null>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/${jobId}/cancel`,
    { method: 'POST' },
  );
}

export function retryGenerationJob(
  projectId: string,
  jobId: number | string,
  idempotencyKey: string,
  canvasBinding?: unknown,
): Promise<JobCreatedData> {
  return apiRequest<JobCreatedData>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/${jobId}/retry`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      ...(canvasBinding ? { body: JSON.stringify({ canvas_binding: canvasBinding }) } : {}),
    },
  );
}

export type VideoFinalizeQuote = StageQuoteView;

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

export interface FetchJobsParams {
  projectId?: string;
  type?: JobType;
  status?: JobStatus;
  size?: number;
  ids?: (number | string)[];
  page?: number;
}

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
