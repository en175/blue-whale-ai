import { createGenerationJob, retryGenerationJob, cancelGenerationJob, type CreateJobPayload } from '@/custom/api/jobs';
import type { GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import { isTaskTypeParamConstraintCode } from '@/custom/utils/video-reference-hints';
import { isAudioMixNodeId } from '../tools/audio/audioMix';
import { isAudioSpeedNodeId } from '../tools/audio/audioSpeed';
import { isAudioTrimNodeId } from '../tools/audio/audioTrim';
import { isMediaExtractNodeId } from '../media/mediaExtract';
import { isVocalSplitNodeId } from '../tools/audio/vocalSplit';
import { audioVideoMuxIdentityOf } from '../tools/audio/audioVideoMux';
import type { Node } from '@xyflow/react';
import { isJobInFlight, isRecoveryTargetSettled, readMarker } from './types';
import type {
  CreateJobOutcome, GenerationRuntimeHost, GenerationTaskDefinition, RecoveryCardPlan, TaskSubmissionInput,
} from './types';

const TARGET_OUTPUT_KEY = '$target';

const TOOL_IDENTITY_KEYS = [
  'imageEnhance', 'videoEnhance', 'frameInterpolation', 'imageErase', 'videoSubtitleErase',
  'imageCutout', 'imageOutpaint', 'vocalSplit', 'sceneSplit', 'smartMatting', 'mediaExtract',
  'audioTrim', 'audioSpeed', 'audioVideoMux',
] as const;

export function isNormalGenerationCard(nodeId: string, nodeData: Record<string, unknown>): boolean {
  if (nodeData.jobId == null) return false;
  if (nodeId.startsWith('generation-result:') && nodeData.generationRecovery != null) return false;
  if (isAudioMixNodeId(nodeId) || isMediaExtractNodeId(nodeId) || isAudioTrimNodeId(nodeId)
    || isAudioSpeedNodeId(nodeId) || isVocalSplitNodeId(nodeId)) return false;
  if (audioVideoMuxIdentityOf({ data: nodeData } as Node) != null) return false;
  return TOOL_IDENTITY_KEYS.every((key) => nodeData[key] == null);
}

export const OUTPUT_SLOT_NODE_PREFIX = 'generation-output:';

export function outputSlotNodeId(slotId: string | number): string {
  return `${OUTPUT_SLOT_NODE_PREFIX}${slotId}`;
}

export type NormalGenerationPayload = CreateJobPayload;

export const normalGenerationTask: GenerationTaskDefinition<NormalGenerationPayload> = {
  taskTypes: ['image', 'video', 'audio'],

  identify: isNormalGenerationCard,


  async create(projectId, input: TaskSubmissionInput<NormalGenerationPayload>, binding, key) {
    const created = await createGenerationJob(
      projectId,
      binding ? ({ ...input.payload, canvas_binding: binding } as CreateJobPayload) : input.payload,
      key,
    );
    return {
      jobId: created.generation_job_id,
      cursor: created.cursor,
      canvasBinding: (created as { canvas_binding?: CreateJobOutcome['canvasBinding'] }).canvas_binding ?? null,
    };
  },

  async retry(projectId, jobId, _nodeData, binding, key) {
    const retried = await retryGenerationJob(projectId, jobId, key, ...(binding ? [binding] : []));
    return {
      jobId: retried.generation_job_id,
      cursor: retried.cursor,
      canvasBinding: (retried as { canvas_binding?: CreateJobOutcome['canvasBinding'] }).canvas_binding ?? null,
    };
  },

  async cancel(projectId, jobId) {
    return cancelGenerationJob(projectId, jobId);
  },

  planRecovery(record: GenerationRecoveryRecord, host: GenerationRuntimeHost): RecoveryCardPlan {
    const target = host.findNode(record.target_node_id);
    const targetExists = target != null;
    const jobStatus = record.job?.status;
    const appliedOnCanvas = (item: GenerationRecoveryRecord['items'][number]) => {
      const marker = readMarker(host.findNode(item.node_id)?.data);
      return marker != null && marker.submissionId === record.submission_id && marker.outputKey === item.output_key;
    };
    const pendingOutputs = record.items.filter(
      (item) => item.output_key !== TARGET_OUTPUT_KEY
        && (item.state === 'pending' || (item.state === 'present' && !appliedOnCanvas(item))),
    );
    if (jobStatus === 'succeeded' && pendingOutputs.length > 0) {
      return {
        kind: 'apply-outputs',
        projection: {
          kind: 'multi-output',
          outputs: pendingOutputs.map((item) => ({
            outputKey: item.output_key,
            nodeId: item.node_id,
            assetId: item.asset_id ?? '',
            url: '',
            mediaType: mediaTypeOfTask(record.task_type),
          })),
        },
      };
    }
    const targetItem = record.items.find((item) => item.output_key === TARGET_OUTPUT_KEY);
    if (targetItem && targetItem.state !== 'pending' && targetItem.state !== 'present') {
      return { kind: 'none' };
    }
    if (isJobInFlight(jobStatus)) {
      if (!targetExists) return { kind: 'restore-target', node: buildRecoveryTargetNode(record) };
      return { kind: 'resume-polling' };
    }
    if (jobStatus === 'failed' && record.is_current) {
      if (target == null) return { kind: 'restore-target', node: buildRecoveryTargetNode(record) };
      const storedCode = (record.job?.stored_error as { code?: number | string } | null)?.code;
      const hasSavedParamConstraint = record.task_type === 'video' && target.data.genStatus === 'failed'
        && String(target.data.jobId) === record.job_id
        && isTaskTypeParamConstraintCode(target.data.errorCode as number | string | undefined);
      if (hasSavedParamConstraint
        && (storedCode === 'provider_failed' || storedCode === 1011 || isTaskTypeParamConstraintCode(storedCode))) {
        return { kind: 'none' };
      }
      if (!hasSavedParamConstraint && isRecoveryTargetSettled(target, record)) return { kind: 'none' };
      host.patchNode(record.target_node_id, {
        jobId: record.job_id,
        generationRecovery: { protocolVersion: 1, submissionId: record.submission_id, outputKey: TARGET_OUTPUT_KEY },
      });
      return { kind: 'resume-polling' };
    }
    return { kind: 'none' };
  },
};

export function mediaTypeOfTask(taskType: string): 'image' | 'video' | 'audio' {
  if (taskType === 'video') return 'video';
  if (taskType === 'audio') return 'audio';
  return 'image';
}

export function buildRecoveryTargetNode(record: GenerationRecoveryRecord): {
  id: string; type: 'mediaNode'; position: { x: number; y: number }; data: Record<string, unknown>;
} {
  const mediaType = mediaTypeOfTask(record.task_type);
  const seed = record.recovery_seed?.target;
  const snapshot = record.previous_target_snapshot;
  const position = readSnapshotPosition(snapshot)
    ?? (seed ? { x: seed.x, y: seed.y } : { x: 0, y: 0 });
  const label = mediaType === 'video' ? '视频' : mediaType === 'audio' ? '音频' : '图片';
  const fileName = (typeof snapshot?.data === 'object' && snapshot.data !== null
    ? String((snapshot.data as Record<string, unknown>).fileName ?? '') : '')
    || seed?.name
    || `${label}生成中`;
  const size = readSnapshotSize(snapshot)
    ?? (seed && seed.width > 0 && seed.height > 0 ? { width: seed.width, height: seed.height } : null);
  const failed = record.job?.status === 'failed';
  const storedError = record.job?.stored_error;
  const failText = typeof storedError === 'object' && storedError != null
    ? String((storedError as Record<string, unknown>).msg ?? (storedError as Record<string, unknown>).message ?? '')
    : '';
  return {
    id: record.target_node_id,
    type: 'mediaNode',
    position,
    data: {
      genStatus: failed ? 'failed' : 'generating',
      progress: failed ? undefined : (record.job?.progress ?? 0),
      mediaType,
      fileName,
      jobId: record.job_id,
      ...(failed ? { generationRecovery: { protocolVersion: 1, submissionId: record.submission_id, outputKey: TARGET_OUTPUT_KEY } } : {}),
      ...(failed && failText ? { errorText: failText } : {}),
      ...(size ? size : {}),
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

function readSnapshotSize(snapshot: Record<string, unknown> | null): { width: number; height: number } | null {
  const width = snapshot?.width;
  const height = snapshot?.height;
  if (typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0) {
    return { width, height };
  }
  return null;
}
