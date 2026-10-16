import { createVocalSplit, createVideoSceneSplit, cancelGenerationJob } from '@/custom/api/jobs';
import { newIdempotencyKey } from '@/shared/api/idempotencyKey';
import type { JobDetail } from '@/custom/api/jobs';
import type { GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import {
  SCENE_SPLIT_EDGE_ORIGIN, SCENE_SPLIT_NODE_GAP, sceneSplitFanoutLayout, sceneSplitSegmentBox,
  sceneSplitSegmentLabel, type SceneSplitGranularity, type SceneSplitIdentity,
} from '../tools/video/sceneSplit';
import {
  VOCAL_SPLIT_DEFAULT_FORMAT, VOCAL_SPLIT_EDGE_ORIGIN, VOCAL_SPLIT_NODE_GAP, isVocalSplitNodeId,
  vocalSplitSourceName, vocalSplitTrackDisplayName, type VocalSplitFormat, type VocalSplitIdentity,
  type VocalSplitScene,
} from '../tools/audio/vocalSplit';
import type { VocalSplitTrackType } from '@lib/contracts/vocal-split';
import { mediaContentBox } from '../components/MediaNode/mediaContentSize';
import { isJobInFlight } from './types';
import type {
  CreateJobOutcome, FanoutCardPlan, FanoutContext, GenerationRuntimeHost,
  GenerationTaskDefinition, RecoveryCardPlan, TaskSubmissionInput,
} from './types';

const TARGET_OUTPUT_KEY = '$target';
const GENERATION_RESULT_NODE_PREFIX = 'generation-result:';
const SEGMENT_OUTPUT_PREFIX = 'segment:';
const TRACK_OUTPUT_PREFIX = 'track:';

function readMarkerOf(nodeData: Record<string, unknown>): { submissionId: string; outputKey: string } | null {
  const marker = nodeData.generationRecovery;
  if (marker == null || typeof marker !== 'object') return null;
  const { submissionId, outputKey } = marker as Record<string, unknown>;
  if (typeof submissionId !== 'string' || typeof outputKey !== 'string') return null;
  return { submissionId, outputKey };
}


export function isSceneSplitCard(nodeId: string, nodeData: Record<string, unknown>): boolean {
  if (nodeId.startsWith(GENERATION_RESULT_NODE_PREFIX)) {
    return readMarkerOf(nodeData)?.outputKey.startsWith(SEGMENT_OUTPUT_PREFIX) ?? false;
  }
  return nodeData.sceneSplit != null;
}

export function isVocalSplitCard(nodeId: string, nodeData: Record<string, unknown>): boolean {
  if (nodeId.startsWith(GENERATION_RESULT_NODE_PREFIX)) {
    return readMarkerOf(nodeData)?.outputKey.startsWith(TRACK_OUTPUT_PREFIX) ?? false;
  }
  return isVocalSplitNodeId(nodeId) || nodeData.vocalSplit != null;
}


export interface SceneSplitTaskPayload {
  source_asset_id: string;
  target_node_id: string;
  granularity: SceneSplitGranularity;
}

export interface VocalSplitTaskPayload {
  source_asset_id: string;
  scene: VocalSplitScene;
  output_format: VocalSplitFormat;
}

type CreatedWithBinding = { job_id: string; canvas_binding?: CreateJobOutcome['canvasBinding'] };

export const sceneSplitTask: GenerationTaskDefinition<SceneSplitTaskPayload> = {
  taskTypes: ['video_scene_split'],

  identify: isSceneSplitCard,

  frozenInput(_nodeId, nodeData) {
    const identity = nodeData.sceneSplit as SceneSplitIdentity | undefined;
    return identity?.lastInput ?? null;
  },

  async create(projectId, input: TaskSubmissionInput<SceneSplitTaskPayload>, binding, key) {
    const created = await createVideoSceneSplit(projectId, {
      ...input.payload,
      ...(binding ? { target_node_id: binding.target_node_id, canvas_binding: binding } : {}),
      client_token: binding ? key : newIdempotencyKey(),
    }, { silent: true });
    return {
      jobId: created.job_id,
      canvasBinding: (created as CreatedWithBinding).canvas_binding ?? null,
    };
  },

  async retry(projectId, _jobId, ctx, binding, key) {
    const identity = ctx.nodeData.sceneSplit as SceneSplitIdentity | undefined;
    if (!identity?.lastInput) throw new Error('场景切分原任务输入不可信，无法重试');
    return sceneSplitTask.create(projectId, { payload: identity.lastInput as SceneSplitTaskPayload }, binding, key);
  },

  async cancel(projectId, jobId) {
    return cancelGenerationJob(projectId, jobId);
  },

  isMultiOutputSuccess(detail: JobDetail) {
    return detail.result == null || (detail.result.segments?.length ?? 0) > 0;
  },

  planRecovery: (record, host) => multiResultPlanRecovery(record, host, {
    mediaType: 'video',
    identityKey: 'sceneSplit',
    edgeOrigin: SCENE_SPLIT_EDGE_ORIGIN,
  }),

  planFanoutCards: planSceneSplitFanoutCards,
};

export const vocalSplitTask: GenerationTaskDefinition<VocalSplitTaskPayload> = {
  taskTypes: ['vocal_split'],

  identify: isVocalSplitCard,

  frozenInput(_nodeId, nodeData) {
    const identity = nodeData.vocalSplit as VocalSplitIdentity | undefined;
    return identity?.lastInput ?? null;
  },

  async create(projectId, input: TaskSubmissionInput<VocalSplitTaskPayload>, binding, key) {
    const created = await createVocalSplit(projectId,
      binding ? { ...input.payload, canvas_binding: binding } : input.payload,
      { silent: true, ...(binding ? { idempotencyKey: key } : {}) },
    );
    return {
      jobId: created.job_id,
      canvasBinding: (created as CreatedWithBinding).canvas_binding ?? null,
    };
  },

  async retry(projectId, _jobId, ctx, binding, key) {
    const identity = ctx.nodeData.vocalSplit as VocalSplitIdentity | undefined;
    if (!identity?.lastInput) throw new Error('人声分离原任务输入不可信，无法重试');
    return vocalSplitTask.create(projectId, { payload: identity.lastInput as VocalSplitTaskPayload }, binding, key);
  },

  async cancel(projectId, jobId) {
    return cancelGenerationJob(projectId, jobId);
  },

  isMultiOutputSuccess(detail: JobDetail) {
    return detail.tracks == null || (detail.tracks?.length ?? 0) > 0;
  },

  planRecovery: (record, host) => multiResultPlanRecovery(record, host, {
    mediaType: 'audio',
    identityKey: null,
    edgeOrigin: VOCAL_SPLIT_EDGE_ORIGIN,
  }),

  planFanoutCards: planVocalSplitFanoutCards,
};


interface MultiResultPlanOptions {
  mediaType: 'video' | 'audio';
  identityKey: 'sceneSplit' | null;
  edgeOrigin: string;
}

function multiResultPlanRecovery(
  record: GenerationRecoveryRecord,
  host: GenerationRuntimeHost,
  options: MultiResultPlanOptions,
): RecoveryCardPlan {
  const targetExists = host.findNode(record.target_node_id) != null;
  const jobStatus = record.job?.status;
  const pendingOutputs = record.items.filter(
    (item) => item.output_key !== TARGET_OUTPUT_KEY && (item.state === 'pending' || item.state === 'present'),
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
          mediaType: options.mediaType,
        })),
      },
    };
  }
  if (isJobInFlight(jobStatus)) {
    if (!targetExists) return { kind: 'restore-target', node: buildMultiResultTargetNode(record, options), edges: recoverySourceEdges(record, host, options.edgeOrigin) };
    return { kind: 'resume-polling' };
  }
  if (jobStatus === 'failed' && !targetExists) {
    return { kind: 'restore-target', node: buildMultiResultTargetNode(record, options), edges: recoverySourceEdges(record, host, options.edgeOrigin) };
  }
  return { kind: 'none' };
}

function buildMultiResultTargetNode(record: GenerationRecoveryRecord, options: MultiResultPlanOptions) {
  const seed = record.recovery_seed?.target;
  const failed = record.job?.status === 'failed';
  const storedError = record.job?.stored_error;
  const failText = typeof storedError === 'object' && storedError != null
    ? String((storedError as Record<string, unknown>).msg ?? (storedError as Record<string, unknown>).message ?? '')
    : '';
  return {
    id: record.target_node_id,
    type: 'mediaNode' as const,
    position: { x: seed?.x ?? 0, y: seed?.y ?? 0 },
    data: {
      src: '',
      fileName: seed?.name || (options.mediaType === 'audio' ? '人声背景分离' : '场景切分'),
      mediaType: options.mediaType,
      genStatus: failed ? 'failed' : 'generating',
      progress: failed ? undefined : (record.job?.progress ?? 0),
      jobId: record.job_id,
      toolMode: 'select',
      ...(failed && failText ? { errorText: failText } : {}),
      ...(seed && seed.width > 0 && seed.height > 0 ? { width: seed.width, height: seed.height } : {}),
    },
  };
}

function recoverySourceEdges(record: GenerationRecoveryRecord, host: GenerationRuntimeHost, origin: string) {
  const sources = record.recovery_seed?.sources ?? [];
  return sources
    .filter((source) => host.findNode(source.node_id) != null)
    .map((source) => ({ source: source.node_id, target: record.target_node_id, origin }));
}


function nodeBoxOf(node: { position: { x: number; y: number }; data?: Record<string, unknown> }): {
  x: number; y: number; width: number; height: number;
} {
  const box = sceneSplitSegmentBox({ width: numberOf(node.data?.width), height: numberOf(node.data?.height) });
  return { x: node.position.x, y: node.position.y, width: box.width, height: box.height };
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function fanoutSourceNode(ctx: FanoutContext) {
  const anchorId = ctx.anchor?.id;
  if (anchorId == null) return null;
  const sourceEdge = ctx.host.getEdges().find((edge) => edge.target === anchorId);
  return sourceEdge ? ctx.host.findNode(sourceEdge.source) : null;
}

function planSceneSplitFanoutCards(ctx: FanoutContext): FanoutCardPlan {
  const segments = ctx.detail.result?.segments ?? [];
  const segmentByOutputKey = new Map(segments.map((seg) => [`${SEGMENT_OUTPUT_PREFIX}${seg.segment_index}`, seg]));
  const source = fanoutSourceNode(ctx);
  const anchorBox = source ? nodeBoxOf(source) : (ctx.anchor ? nodeBoxOf(ctx.anchor) : { x: 0, y: 0, width: 320, height: 320 });
  const fallbackWidth = numberOf(source?.data?.width);
  const fallbackHeight = numberOf(source?.data?.height);
  const occupied = ctx.host.getMediaNodes()
    .filter((node) => node.id !== ctx.anchor?.id && node.id !== source?.id)
    .map(nodeBoxOf);
  const positions = sceneSplitFanoutLayout({
    anchor: anchorBox,
    count: ctx.outputs.length,
    segmentSize: sceneSplitSegmentBox({ width: fallbackWidth, height: fallbackHeight }),
    occupied,
  });
  const fallbackPos = {
    x: Math.round(anchorBox.x + anchorBox.width + SCENE_SPLIT_NODE_GAP),
    y: Math.round(anchorBox.y),
  };
  const nodes = ctx.outputs.map((output, index) => {
    const segment = segmentByOutputKey.get(output.outputKey);
    return {
      id: output.nodeId,
      position: positions[index] ?? fallbackPos,
      data: {
        fileName: segment
          ? sceneSplitSegmentLabel(segment.segment_index, segment.start_time, segment.end_time)
          : `生成-${ctx.jobId}-${index + 1}`,
        mediaType: 'video' as const,
        width: output.width ?? fallbackWidth,
        height: output.height ?? fallbackHeight,
        jobId: ctx.jobId,
      },
    };
  });
  const edges = source
    ? nodes.map((node) => ({ source: source.id, target: node.id, origin: SCENE_SPLIT_EDGE_ORIGIN }))
    : [];
  return { nodes, edges };
}

function planVocalSplitFanoutCards(ctx: FanoutContext): FanoutCardPlan {
  const identity = ctx.anchor?.data?.vocalSplit as VocalSplitIdentity | undefined;
  const outputFormat = identity?.lastInput.output_format ?? VOCAL_SPLIT_DEFAULT_FORMAT;
  const sourceName = ctx.anchor ? vocalSplitSourceName(ctx.anchor.data?.fileName) : '';
  const anchorPos = ctx.anchor?.position ?? { x: 0, y: 0 };
  const box = mediaContentBox({ mediaType: 'audio' });
  const nodes = ctx.outputs.map((output, index) => ({
    id: output.nodeId,
    position: {
      x: Math.round(anchorPos.x),
      y: Math.round(anchorPos.y + index * (box.height + VOCAL_SPLIT_NODE_GAP)),
    },
    data: {
      fileName: vocalSplitTrackDisplayName(sourceName, output.outputKey.slice(TRACK_OUTPUT_PREFIX.length) as VocalSplitTrackType, outputFormat),
      mediaType: 'audio' as const,
      progress: 100,
      ...(output.duration != null ? { duration: output.duration } : {}),
      toolMode: 'select',
    },
  }));
  const source = fanoutSourceNode(ctx);
  const edges = source
    ? nodes.map((node) => ({ source: source.id, target: node.id, origin: VOCAL_SPLIT_EDGE_ORIGIN }))
    : [];
  return { nodes, edges };
}
