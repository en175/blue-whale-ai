import {
  cancelGenerationJob,
  createAudioSpeed, createAudioTrim, createFrameInterpolation, createMediaExtraction,
  createVideoEnhancement, createVideoMatting, createVideoSubtitleErase,
  type CreateAudioSpeedPayload, type CreateAudioTrimPayload, type CreateFrameInterpolationPayload,
  type CreateMediaExtractionPayload, type CreateVideoEnhancementPayload,
  type CreateVideoMattingPayload, type CreateVideoSubtitleErasePayload,
  type MediaToolCanvasBindingView, readJobFailText,
} from '@/api/jobs';
import type { CanvasBinding, GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { isAudioSpeedNodeId } from '../audioSpeed';
import { isAudioTrimNodeId } from '../audioTrim';
import { isMediaExtractNodeId } from '../mediaExtract';
import { buildFrameInterpolationInput, restoreFrameInterpolationRetryFps } from '../frameInterpolation';
import { buildVideoEnhanceInput, restoreVideoEnhanceResolution } from '../videoEnhance';
import { isRecoveryTargetSettled } from './types';
import type {
  GenerationRuntimeHost, GenerationTaskDefinition, RecoveryCardPlan, TaskSubmissionInput,
} from './types';

const TARGET_OUTPUT_KEY = '$target';
export type VideoToolPayload =
  | { kind: 'subtitleErase'; input: CreateVideoSubtitleErasePayload }
  | { kind: 'mediaExtract'; input: CreateMediaExtractionPayload }
  | { kind: 'audioTrim'; input: CreateAudioTrimPayload }
  | { kind: 'audioSpeed'; input: CreateAudioSpeedPayload }
  | { kind: 'smartMatting'; input: Omit<CreateVideoMattingPayload, 'client_token'> }
  | { kind: 'videoEnhance'; input: CreateVideoEnhancementPayload }
  | { kind: 'frameInterpolation'; input: CreateFrameInterpolationPayload };

type VideoToolKind = VideoToolPayload['kind'];

interface VideoToolSpec {
  kind: VideoToolKind;
  taskType: string;
  identityKey: string;
  mediaType: 'video' | 'audio';
  recoveryName: string;
  edgeOrigin: string;
}

const SPECS: readonly VideoToolSpec[] = [
  { kind: 'subtitleErase', taskType: 'video_subtitle_erase', identityKey: 'videoSubtitleErase', mediaType: 'video', recoveryName: '去字幕', edgeOrigin: 'video-subtitle-erase' },
  { kind: 'mediaExtract', taskType: 'media_extract', identityKey: 'mediaExtract', mediaType: 'audio', recoveryName: '音视频分离', edgeOrigin: 'media-extract' },
  { kind: 'audioTrim', taskType: 'audio_trim', identityKey: 'audioTrim', mediaType: 'audio', recoveryName: '音频截取', edgeOrigin: 'audio-trim' },
  { kind: 'audioSpeed', taskType: 'audio_speed', identityKey: 'audioSpeed', mediaType: 'audio', recoveryName: '音频调速', edgeOrigin: 'audio-speed' },
  { kind: 'smartMatting', taskType: 'video_matting', identityKey: 'smartMatting', mediaType: 'video', recoveryName: '智能抠像', edgeOrigin: 'smart-matting' },
  { kind: 'videoEnhance', taskType: 'video_enhance', identityKey: 'videoEnhance', mediaType: 'video', recoveryName: 'HD 高清', edgeOrigin: 'video-enhance' },
  { kind: 'frameInterpolation', taskType: 'video_frame_interpolation', identityKey: 'frameInterpolation', mediaType: 'video', recoveryName: '视频插帧', edgeOrigin: 'frame-interpolation' },
];

const SPEC_BY_TASK_TYPE = new Map(SPECS.map((spec) => [spec.taskType, spec]));

const SPEC_BY_KIND = new Map<VideoToolKind, VideoToolSpec>(SPECS.map((spec) => [spec.kind, spec]));

export function videoToolSpecOf(nodeId: string, nodeData: Record<string, unknown>): VideoToolSpec | null {
  if (isMediaExtractNodeId(nodeId) || nodeData.mediaExtract != null) return SPEC_BY_KIND.get('mediaExtract') ?? null;
  if (isAudioTrimNodeId(nodeId) || nodeData.audioTrim != null) return SPEC_BY_KIND.get('audioTrim') ?? null;
  if (isAudioSpeedNodeId(nodeId) || nodeData.audioSpeed != null) return SPEC_BY_KIND.get('audioSpeed') ?? null;
  if (nodeData.videoSubtitleErase != null) return SPEC_BY_KIND.get('subtitleErase') ?? null;
  if (nodeData.smartMatting != null) return SPEC_BY_KIND.get('smartMatting') ?? null;
  if (nodeData.videoEnhance != null) return SPEC_BY_KIND.get('videoEnhance') ?? null;
  if (nodeData.frameInterpolation != null) return SPEC_BY_KIND.get('frameInterpolation') ?? null;
  return null;
}

export function videoToolFrozenPayload(
  nodeId: string,
  nodeData: Record<string, unknown>,
): VideoToolPayload | null {
  const spec = videoToolSpecOf(nodeId, nodeData);
  if (spec == null) return null;
  const identity = nodeData[spec.identityKey] as Record<string, unknown> | undefined | null;
  if (identity == null || typeof identity !== 'object') return null;
  switch (spec.kind) {
    case 'subtitleErase':
    case 'mediaExtract':
    case 'audioTrim':
    case 'audioSpeed':
    case 'smartMatting': {
      const input = identity.lastInput as Record<string, unknown> | undefined;
      if (input == null || typeof input.source_asset_id !== 'string') return null;
      return { kind: spec.kind, input } as VideoToolPayload;
    }
    case 'videoEnhance': {
      const sourceAssetId = identity.sourceAssetId;
      if (typeof sourceAssetId !== 'string' || !sourceAssetId) return null;
      const input = buildVideoEnhanceInput(sourceAssetId, nodeId, restoreVideoEnhanceResolution(identity.lastParams as Record<string, unknown> | undefined));
      return input ? { kind: spec.kind, input } : null;
    }
    case 'frameInterpolation': {
      const sourceAssetId = identity.sourceAssetId;
      if (identity.recoveryBlocked === true) return null;
      if (typeof sourceAssetId !== 'string' || !sourceAssetId) return null;
      const input = buildFrameInterpolationInput(
        sourceAssetId, nodeId,
        restoreFrameInterpolationRetryFps(identity as { lastParams?: Record<string, unknown>; frozenParams?: Record<string, unknown> }),
      );
      return input ? { kind: spec.kind, input } : null;
    }
  }
}

async function dispatchCreate(
  projectId: string,
  payload: VideoToolPayload,
  binding: CanvasBinding | null,
  key: string,
): Promise<{ job_id: string; canvas_binding?: MediaToolCanvasBindingView }> {
  switch (payload.kind) {
    case 'subtitleErase':
      return createVideoSubtitleErase(projectId, payload.input, { silent: true, canvasBinding: binding, idempotencyKey: key });
    case 'mediaExtract':
      return createMediaExtraction(projectId, payload.input, { silent: true, canvasBinding: binding, idempotencyKey: key });
    case 'audioTrim':
      return createAudioTrim(projectId, payload.input, { silent: true, canvasBinding: binding, idempotencyKey: key });
    case 'audioSpeed':
      return createAudioSpeed(projectId, payload.input, { silent: true, canvasBinding: binding, idempotencyKey: key });
    case 'videoEnhance':
      return createVideoEnhancement(projectId, payload.input, { silent: true, canvasBinding: binding, idempotencyKey: key });
    case 'frameInterpolation':
      return createFrameInterpolation(projectId, payload.input, { silent: true, canvasBinding: binding, idempotencyKey: key });
    case 'smartMatting':
      return createVideoMatting(projectId, { ...payload.input, client_token: key }, { silent: true, canvasBinding: binding });
  }
}

export function buildVideoToolRecoveryNode(
  record: GenerationRecoveryRecord,
  spec: VideoToolSpec,
): { id: string; type: 'mediaNode'; position: { x: number; y: number }; data: Record<string, unknown> } {
  const seed = record.recovery_seed?.target;
  const snapshotPos = readSnapshotPosition(record.previous_target_snapshot);
  const failed = record.job?.status === 'failed';
  return {
    id: record.target_node_id,
    type: 'mediaNode',
    position: seed ? { x: seed.x, y: seed.y } : snapshotPos ?? { x: 0, y: 0 },
    data: {
      src: '',
      genStatus: failed ? 'failed' : 'generating',
      progress: failed ? undefined : (record.job?.progress ?? 0),
      mediaType: spec.mediaType,
      fileName: seed?.name || spec.recoveryName,
      jobId: record.job_id,
      ...(failed ? { generationRecovery: { protocolVersion: 1, submissionId: record.submission_id, outputKey: TARGET_OUTPUT_KEY } } : {}),
      ...(failed ? { errorText: readJobFailText(record.job?.stored_error as { code?: string | number; message?: string; msg?: string } | null) || `${spec.recoveryName}失败，请重试` } : {}),
      ...(seed && seed.width > 0 && seed.height > 0 ? { width: seed.width, height: seed.height } : {}),
      [spec.identityKey]: {},
    },
  };
}

function readSnapshotPosition(snapshot: Record<string, unknown> | null): { x: number; y: number } | null {
  const pos = snapshot?.position;
  if (pos != null && typeof pos === 'object' && typeof (pos as { x?: unknown }).x === 'number' && typeof (pos as { y?: unknown }).y === 'number') {
    return { x: (pos as { x: number; y: number }).x, y: (pos as { x: number; y: number }).y };
  }
  return null;
}

export const videoToolsTask: GenerationTaskDefinition<VideoToolPayload> = {
  taskTypes: SPECS.map((spec) => spec.taskType),

  identify: (nodeId, nodeData) => videoToolSpecOf(nodeId, nodeData) != null,

  frozenInput: (nodeId, nodeData) => videoToolFrozenPayload(nodeId, nodeData),

  async create(projectId, input: TaskSubmissionInput<VideoToolPayload>, binding, key) {
    const created = await dispatchCreate(projectId, input.payload, binding, key);
    return { jobId: created.job_id, canvasBinding: created.canvas_binding ?? null };
  },

  async retry(projectId, _jobId, { nodeId, nodeData }, binding, key) {
    const payload = videoToolFrozenPayload(nodeId, nodeData);
    if (payload == null) throw new Error('原任务输入已不可信');
    const created = await dispatchCreate(projectId, payload, binding, key);
    return { jobId: created.job_id, canvasBinding: created.canvas_binding ?? null };
  },

  async cancel(projectId, jobId) {
    return cancelGenerationJob(projectId, jobId);
  },

  planRecovery(record: GenerationRecoveryRecord, host: GenerationRuntimeHost): RecoveryCardPlan {
    const spec = SPEC_BY_TASK_TYPE.get(record.task_type);
    if (spec == null) return { kind: 'none' };
    const status = record.job?.status;
    const target = host.findNode(record.target_node_id);
    if (status !== 'queued' && status !== 'processing' && status !== 'checking'
      && status !== 'succeeded' && status !== 'failed') return { kind: 'none' };
    if (status === 'succeeded' || status === 'failed') {
      const primary = record.items.find((item) => item.output_key !== TARGET_OUTPUT_KEY);
      if (status === 'succeeded' && (primary == null || primary.state !== 'pending')) return { kind: 'none' };
      if (status === 'failed') {
        if (!record.is_current) return { kind: 'none' };
        if (target != null) {
          if (isRecoveryTargetSettled(target, record)) return { kind: 'none' };
          host.patchNode(record.target_node_id, {
            jobId: record.job_id,
            generationRecovery: { protocolVersion: 1, submissionId: record.submission_id, outputKey: TARGET_OUTPUT_KEY },
            [spec.identityKey]: target.data?.[spec.identityKey] ?? {},
          });
        }
      }
    }
    if (target == null) {
      host.insertMediaNode(buildVideoToolRecoveryNode(record, spec));
      for (const source of record.recovery_seed?.sources ?? []) {
        if (host.findNode(source.node_id) != null) {
          host.addEdge(source.node_id, record.target_node_id, undefined, { origin: spec.edgeOrigin });
        }
      }
    } else if (((target.data ?? {}).genStatus !== 'generating' && (target.data ?? {}).genStatus !== 'checking')) {
      host.patchNode(record.target_node_id, { genStatus: 'generating', progress: record.job?.progress ?? 0, errorText: undefined, jobId: record.job_id });
    }
    return { kind: 'resume-polling' };
  },
};
