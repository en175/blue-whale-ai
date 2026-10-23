import {
  createAudioMix, retryAudioMix, createAudioVideoMux, retryAudioVideoMux,
  cancelGenerationJob, type CreateAudioVideoMuxPayload, type DedicatedRetryCreatedData,
} from '@/custom/api/jobs';
import type { AudioMixCreate } from '@lib/contracts/audio-mix';
import type { GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import { isAudioMixNodeId, buildAudioMixPlaceholderNode, audioMixSourceError, AUDIO_MIX_EDGE_ORIGIN, AUDIO_MIX_FORMATS, type AudioMixFormat } from '../tools/audio/audioMix';
import { audioVideoMuxIdentityOf, buildAudioVideoMuxPlaceholderNode } from '../tools/audio/audioVideoMux';
import type { Node } from '@xyflow/react';
import { isJobInFlight, isRecoveryTargetRestorable } from './types';
import type {
  CreateJobOutcome, GenerationRuntimeHost, GenerationTaskDefinition, RecoveryCardPlan,
  RuntimeNodeView, TaskSubmissionInput,
} from './types';

const TARGET_OUTPUT_KEY = '$target';

type MixSubmitWatcher = { accepted(jobId: string): void; failed(error: unknown): void };
const submitWatchers = new Map<string, MixSubmitWatcher>();

export function staleMixSubmitError(): Error {
  return new Error('画布已重新加载，任务未提交，请重试');
}

export function watchMixSubmit(nodeId: string, watcher: MixSubmitWatcher): () => void {
  submitWatchers.set(nodeId, watcher);
  return () => { if (submitWatchers.get(nodeId) === watcher) submitWatchers.delete(nodeId); };
}

function signalAccepted(nodeId: string, jobId: string, watcher: MixSubmitWatcher | undefined): void {
  if (submitWatchers.get(nodeId) !== watcher) return;
  submitWatchers.delete(nodeId);
  watcher?.accepted(jobId);
}
function signalFailed(nodeId: string, error: unknown, watcher: MixSubmitWatcher | undefined): void {
  if (submitWatchers.get(nodeId) !== watcher) return;
  submitWatchers.delete(nodeId);
  watcher?.failed(error);
}

function signalCreateOutcome(
  nodeId: string,
  jobId: string,
  watcher: MixSubmitWatcher | undefined,
  ownsExecution: (() => boolean) | undefined,
  view: { is_current: boolean } | null,
): void {
  if (view && view.is_current === false) {
    signalFailed(nodeId, staleMixSubmitError(), watcher);
    return;
  }
  if (ownsExecution !== undefined && !ownsExecution()) {
    signalFailed(nodeId, staleMixSubmitError(), watcher);
    return;
  }
  signalAccepted(nodeId, jobId, watcher);
}

function dedicatedRetryOutcome(retried: DedicatedRetryCreatedData): CreateJobOutcome {
  return { jobId: retried.job_id, canvasBinding: retried.canvas_binding ?? null };
}


function recoveryPosition(record: GenerationRecoveryRecord): { x: number; y: number } {
  const pos = record.previous_target_snapshot?.position as { x?: unknown; y?: unknown } | undefined;
  if (pos != null && typeof pos.x === 'number' && typeof pos.y === 'number') return { x: pos.x, y: pos.y };
  const seed = record.recovery_seed?.target;
  if (seed) return { x: seed.x, y: seed.y };
  return { x: 0, y: 0 };
}

function failTextOf(record: GenerationRecoveryRecord): string {
  const storedError = record.job?.stored_error as { msg?: unknown; message?: unknown } | null | undefined;
  if (storedError != null && typeof storedError === 'object') {
    const text = String(storedError.msg ?? storedError.message ?? '');
    if (text) return text;
  }
  return '';
}

function mixFormatOf(name: string | undefined): AudioMixFormat {
  const dot = typeof name === 'string' ? name.lastIndexOf('.') : -1;
  const ext = dot > 0 ? name!.slice(dot + 1).toLowerCase() : '';
  return (AUDIO_MIX_FORMATS as readonly string[]).includes(ext) ? ext as AudioMixFormat : 'mp3';
}

function planMixMuxRecovery(
  record: GenerationRecoveryRecord,
  host: GenerationRuntimeHost,
  mediaType: 'audio' | 'video',
  buildRestore: (record: GenerationRecoveryRecord) => RuntimeNodeView | null,
): RecoveryCardPlan {
  const target = host.findNode(record.target_node_id);
  const targetExists = target != null;
  const jobStatus = record.job?.status;
  const pendingOutputs = record.items.filter(
    (item) => item.output_key !== TARGET_OUTPUT_KEY
      && (item.state === 'pending' || (item.state === 'present' && host.findNode(item.node_id) == null)),
  );
  if (jobStatus === 'succeeded' && pendingOutputs.length > 0) {
    return {
      kind: 'apply-outputs',
      ...(!targetExists ? { unavailableTarget: buildRestore(record) ?? undefined } : {}),
      projection: {
        kind: 'multi-output',
        outputs: pendingOutputs.map((item) => ({
          outputKey: item.output_key,
          nodeId: item.node_id,
          assetId: item.asset_id ?? '',
          url: '',
          mediaType,
        })),
      },
    };
  }
  if (jobStatus !== 'succeeded' && !isRecoveryTargetRestorable(record)) return { kind: 'none' };
  if (isJobInFlight(jobStatus)) {
    if (!targetExists) {
      const node = buildRestore(record);
      if (node) return { kind: 'restore-target', node };
      return { kind: 'none' };
    }
    return { kind: 'resume-polling' };
  }
  if (jobStatus === 'failed') {
    if (!targetExists) {
      const node = buildRestore(record);
      if (node) return { kind: 'restore-target', node };
      return { kind: 'none' };
    }
    const data = target?.data;
    if (data?.genStatus === 'generating' || data?.genStatus === 'checking' || data?.jobId == null) {
      return { kind: 'resume-polling' };
    }
    return { kind: 'none' };
  }
  return { kind: 'none' };
}


export const audioMixTask: GenerationTaskDefinition<AudioMixCreate> = {
  taskTypes: ['audio_mix'],

  identify(nodeId, nodeData) {
    return isAudioMixNodeId(nodeId) && nodeData.jobId != null;
  },

  async create(projectId, input: TaskSubmissionInput<AudioMixCreate>, binding, key, ownsExecution) {
    const nodeId = input.target!.targetNodeId;
    const watcher = submitWatchers.get(nodeId);
    try {
      const created = await createAudioMix(
        projectId,
        binding ? { ...input.payload, canvas_binding: binding } : input.payload,
        { silent: true, idempotencyKey: key },
      );
      const view = (created as { canvas_binding?: CreateJobOutcome['canvasBinding'] }).canvas_binding ?? null;
      signalCreateOutcome(nodeId, created.job_id, watcher, ownsExecution, view);
      return { jobId: created.job_id, canvasBinding: view };
    } catch (e) {
      signalFailed(nodeId, e, watcher);
      throw e;
    }
  },

  async retry(projectId, jobId, _nodeData, binding, key) {
    const retried = await retryAudioMix(projectId, jobId, key, { silent: true }, binding ?? undefined);
    return dedicatedRetryOutcome(retried);
  },

  async cancel(projectId, jobId) {
    return cancelGenerationJob(projectId, jobId);
  },

  planRecovery(record, host) {
    const plan = planMixMuxRecovery(record, host, 'audio', (rec) => {
      const seed = rec.recovery_seed?.target;
      const failed = rec.job?.status === 'failed';
      const failText = failTextOf(rec);
      const node = buildAudioMixPlaceholderNode(
        rec.target_node_id,
        mixFormatOf(seed?.name),
        recoveryPosition(rec),
      );
      return {
        id: node.id,
        type: 'mediaNode',
        position: node.position,
        data: {
          ...node.data,
          jobId: rec.job_id,
          ...(failed ? { genStatus: 'failed', ...(failText ? { errorText: failText } : {}) } : {}),
        },
      };
    });
    if (plan.kind !== 'restore-target' || record.job?.status !== 'failed') return plan;
    const sources = [...new Set((record.recovery_seed?.sources ?? []).map((source) => source.node_id))];
    return {
      ...plan,
      edges: sources.filter((sourceId) => {
        if (sourceId === record.target_node_id || host.isLocallyRemoved(sourceId)) return false;
        const source = host.findNode(sourceId);
        return source != null && audioMixSourceError(source as Node) == null
          && !host.getEdges().some((edge) => edge.source === sourceId && edge.target === record.target_node_id);
      }).map((source) => ({ source, target: record.target_node_id, origin: AUDIO_MIX_EDGE_ORIGIN })),
    };
  },
};


export const audioVideoMuxTask: GenerationTaskDefinition<CreateAudioVideoMuxPayload> = {
  taskTypes: ['audio_video_mux'],

  identify(nodeId, nodeData) {
    if (nodeData.jobId == null) return false;
    return audioVideoMuxIdentityOf({ id: nodeId, type: 'mediaNode', data: nodeData } as Node) != null;
  },

  async create(projectId, input: TaskSubmissionInput<CreateAudioVideoMuxPayload>, binding, key, ownsExecution) {
    const nodeId = input.target!.targetNodeId;
    const watcher = submitWatchers.get(nodeId);
    try {
      const created = await createAudioVideoMux(
        projectId,
        binding ? { ...input.payload, canvas_binding: binding } : input.payload,
        { silent: true, idempotencyKey: key },
      );
      const view = (created as { canvas_binding?: CreateJobOutcome['canvasBinding'] }).canvas_binding ?? null;
      signalCreateOutcome(nodeId, created.job_id, watcher, ownsExecution, view);
      return { jobId: created.job_id, canvasBinding: view };
    } catch (e) {
      signalFailed(nodeId, e, watcher);
      throw e;
    }
  },

  async retry(projectId, jobId, _nodeData, binding, key) {
    const retried = await retryAudioVideoMux(projectId, jobId, key, { silent: true }, binding ?? undefined);
    return dedicatedRetryOutcome(retried);
  },

  async cancel(projectId, jobId) {
    return cancelGenerationJob(projectId, jobId);
  },

  planRecovery(record, host) {
    return planMixMuxRecovery(record, host, 'video', (rec) => {
      const snapshotData = rec.previous_target_snapshot?.data;
      const identity = audioVideoMuxIdentityOf({
        id: rec.target_node_id,
        type: 'mediaNode',
        data: (snapshotData != null && typeof snapshotData === 'object' ? snapshotData : {}) as Record<string, unknown>,
      } as Node);
      if (identity == null) return null;
      const failed = rec.job?.status === 'failed';
      const failText = failTextOf(rec);
      const node = buildAudioVideoMuxPlaceholderNode(rec.target_node_id, identity, rec.job_id, recoveryPosition(rec));
      return {
        id: node.id,
        type: 'mediaNode',
        position: node.position,
        data: {
          ...node.data,
          ...(failed ? { genStatus: 'failed', ...(failText ? { errorText: failText } : {}) } : {}),
        },
      };
    });
  },
};
