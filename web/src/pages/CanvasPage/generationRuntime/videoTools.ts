/* ============================================
 * 视频处理任务家族定义（IKJJR3，IKIXK9-SPEC-20261002 A 节）：
 * 去字幕 / 音视频分离 / 截取 / 调速 / 抠像 / 视频 HD / 插帧七类单结果后台入口。
 * 差异承载：身份识别（data 身份键 + 节点 id 前缀家族）、冻结输入（identity.lastInput /
 * lastParams / frozenParams）、创建请求（各自端点；canvas_binding 进 body，除抠像外
 * Idempotency-Key 头承载 submission_id，抠像走 body client_token = submission_id）、
 * 通用取消端点、恢复落卡规划（单结果：补卡 + 续轮询收敛，一对一转换复用目标卡）。
 * 共同锁/调度/归属检查/保存确认在 runtime.ts，不在此重复。
 * ============================================ */
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
import type {
  GenerationRuntimeHost, GenerationTaskDefinition, RecoveryCardPlan, TaskSubmissionInput,
} from './types';

const TARGET_OUTPUT_KEY = '$target';/** 家族载荷（页面在工具提交时机组好；kind 判别各端点）。 */
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
  /** 恢复记录分派键（generation_jobs.type 契约值）。 */
  taskType: string;
  /** 卡片 data 身份键（成功即清身份的家族由收敛器负责；前缀家族卡兜底用）。 */
  identityKey: string;
  /** 恢复补卡媒体类型。 */
  mediaType: 'video' | 'audio';
  /** 恢复补卡兜底名（恢复种子 name 优先）。 */
  recoveryName: string;
  /** 来源边 origin 标记（恢复补卡的来源线差异，与各工具建卡先例同值）。 */
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

/** 家族身份：七类身份键或节点 id 前缀（分离/截取/调速的卡身份在 data 键之上叠加前缀兜底，
 *  覆盖 sourceAssetId 未知时无身份标记的历史占位卡）。 */
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

/** 冻结输入（失败卡重试原样重发的客户端载荷）：identity.lastInput 家族直接取冻结 input；
 *  HD 取 lastParams（resolution 单键 + 身份 sourceAssetId 组契约三键）；插帧取受理冻结的
 *  frozenParams（IKHSFH：60fps 任务失败后面板改 120fps，重试仍发 60fps；旧卡回落 lastParams）。
 *  身份缺失/字段不可信 = null（运行时保留失败卡并提示重新编辑，A.6 不猜参数）。 */
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
      if (identity.recoveryBlocked === true) return null; // 恢复查询失败：冻结输入未回填，不按面板值猜
      if (typeof sourceAssetId !== 'string' || !sourceAssetId) return null;
      const input = buildFrameInterpolationInput(
        sourceAssetId, nodeId,
        restoreFrameInterpolationRetryFps(identity as { lastParams?: Record<string, unknown>; frozenParams?: Record<string, unknown> }),
      );
      return input ? { kind: spec.kind, input } : null;
    }
  }
}

/** 按家族分派创建请求（canvas_binding 进 body；除抠像外 Idempotency-Key 头承载 submission_id；
 *  抠像幂等承载为 body client_token = submission_id，B.3「工具原 client_token」口径）。 */
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

/** 恢复补卡（受理回执丢失场景）：按恢复种子/原目标快照补目标占位卡；身份键写空对象
 *  占位（claims 分派覆盖取消/删除/重试；冻结输入缺失时重试按 A.6 阻止并提示重新编辑）。 */
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

/** 视频处理任务家族定义（恢复记录按 task_type 七值分派）。 */
export const videoToolsTask: GenerationTaskDefinition<VideoToolPayload> = {
  taskTypes: SPECS.map((spec) => spec.taskType),

  identify: (nodeId, nodeData) => videoToolSpecOf(nodeId, nodeData) != null,

  frozenInput: (nodeId, nodeData) => videoToolFrozenPayload(nodeId, nodeData),

  async create(projectId, input: TaskSubmissionInput<VideoToolPayload>, binding, key) {
    const created = await dispatchCreate(projectId, input.payload, binding, key);
    return { jobId: created.job_id, canvasBinding: created.canvas_binding ?? null };
  },

  // 家族无服务端 retry 端点：重试 = 冻结输入原样重发创建端点（新 submission_id 独立提交身份）。
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
    // 已取消：不猜卡（草稿回退/空占位移除已按服务端状态收敛）
    if (status !== 'queued' && status !== 'processing' && status !== 'checking'
      && status !== 'succeeded' && status !== 'failed') return { kind: 'none' };
    // 单结果已落卡（primary present）或用户已删除（removed）：无画布动作
    if (status === 'succeeded' || status === 'failed') {
      const primary = record.items.find((item) => item.output_key !== TARGET_OUTPUT_KEY);
      if (status === 'succeeded' && (primary == null || primary.state !== 'pending')) return { kind: 'none' };
      if (status === 'failed' && host.findNode(record.target_node_id) != null) return { kind: 'none' };
    }
    // 目标卡缺失（受理回执丢失）：先按恢复种子补卡 + 来源线（仅实际画布节点，不伪造），
    // 续轮询由恢复扫描接管（一对一转换复用本卡）
    const target = host.findNode(record.target_node_id);
    if (target == null) {
      host.insertMediaNode(buildVideoToolRecoveryNode(record, spec));
      for (const source of record.recovery_seed?.sources ?? []) {
        if (host.findNode(source.node_id) != null) {
          host.addEdge(source.node_id, record.target_node_id, undefined, { origin: spec.edgeOrigin });
        }
      }
    } else if (((target.data ?? {}).genStatus !== 'generating' && (target.data ?? {}).genStatus !== 'checking')) {
      // 持久化失败/草稿态的卡被新提交接管（同节点重试已受理）：转回生成中续轮询
      host.patchNode(record.target_node_id, { genStatus: 'generating', progress: record.job?.progress ?? 0, errorText: undefined, jobId: record.job_id });
    }
    return { kind: 'resume-polling' };
  },
};
