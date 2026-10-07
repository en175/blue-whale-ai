/* ============================================
 * 多结果家族类型定义（IKJJR5，IKIXK9-SPEC-20261002 B.4）：场景切分 + 人声分离。
 *
 * 差异承载：
 *  - 身份识别：占位卡（sceneSplit 身份 / vocal-split- 前缀）+ 规范结果卡
 *    （generation-result:<submission_id>:segment:<n> / :track:<type>，B.4 规范 node_id）。
 *  - 冻结输入：契约无 retry 端点，失败卡按 identity.lastInput 原参数重发创建接口；
 *    恢复补出的失败卡无业务参数（不可信）→ 保留卡片提示重新编辑。
 *  - 成功多结果判定（isMultiOutputSuccess）：按可信终态数据——场景切分 1 段仍为
 *    segment:1 多结果路径，不落入一对一 primary 转换。
 *  - 扇出落卡（planFanoutCards）：沿用两家族既有排列规则（场景切分网格避让 + 段起止
 *    命名；人声分离纵向轨列 + 源名(轨词).格式 命名）与来源线（origin 标记）。
 * ============================================ */
import { createVocalSplit, createVideoSceneSplit, cancelGenerationJob } from '@/api/jobs';
import { newIdempotencyKey } from '@/api/idempotencyKey';
import type { JobDetail } from '@/api/jobs';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import {
  SCENE_SPLIT_EDGE_ORIGIN, SCENE_SPLIT_NODE_GAP, sceneSplitFanoutLayout, sceneSplitSegmentBox,
  sceneSplitSegmentLabel, type SceneSplitGranularity, type SceneSplitIdentity,
} from '../sceneSplit';
import {
  VOCAL_SPLIT_DEFAULT_FORMAT, VOCAL_SPLIT_EDGE_ORIGIN, VOCAL_SPLIT_NODE_GAP, isVocalSplitNodeId,
  vocalSplitSourceName, vocalSplitTrackDisplayName, type VocalSplitFormat, type VocalSplitIdentity,
  type VocalSplitScene,
} from '../vocalSplit';
import type { VocalSplitTrackType } from '@lib/contracts/vocal-split';
import { mediaContentBox } from '../components/MediaNode/mediaContentSize';
import { isJobInFlight } from './types';
import type {
  CreateJobOutcome, FanoutCardPlan, FanoutContext, GenerationRuntimeHost,
  GenerationTaskDefinition, RecoveryCardPlan, TaskSubmissionInput,
} from './types';

const TARGET_OUTPUT_KEY = '$target';
/** 多结果规范节点前缀（与后端 GENERATION_RESULT_NODE_PREFIX 同源，B.4）。 */
const GENERATION_RESULT_NODE_PREFIX = 'generation-result:';
const SEGMENT_OUTPUT_PREFIX = 'segment:';
const TRACK_OUTPUT_PREFIX = 'track:';

/** 恢复项 marker 读数（data.generationRecovery，B.4）。 */
function readMarkerOf(nodeData: Record<string, unknown>): { submissionId: string; outputKey: string } | null {
  const marker = nodeData.generationRecovery;
  if (marker == null || typeof marker !== 'object') return null;
  const { submissionId, outputKey } = marker as Record<string, unknown>;
  if (typeof submissionId !== 'string' || typeof outputKey !== 'string') return null;
  return { submissionId, outputKey };
}

// ── 身份识别 ──────────────────────────────────────────────────────────────────

/** 场景切分卡：占位卡（sceneSplit 身份）或规范段卡（marker outputKey = segment:<n>）。 */
export function isSceneSplitCard(nodeId: string, nodeData: Record<string, unknown>): boolean {
  if (nodeId.startsWith(GENERATION_RESULT_NODE_PREFIX)) {
    return readMarkerOf(nodeData)?.outputKey.startsWith(SEGMENT_OUTPUT_PREFIX) ?? false;
  }
  return nodeData.sceneSplit != null;
}

/** 人声分离卡：占位卡（vocal-split- 前缀或 vocalSplit 身份）或规范轨卡（track:<type>）。
 *  旧轨卡（vocal-track-*，无 marker）不认领——继续按普通生成通用重试承接（历史口径）。 */
export function isVocalSplitCard(nodeId: string, nodeData: Record<string, unknown>): boolean {
  if (nodeId.startsWith(GENERATION_RESULT_NODE_PREFIX)) {
    return readMarkerOf(nodeData)?.outputKey.startsWith(TRACK_OUTPUT_PREFIX) ?? false;
  }
  return isVocalSplitNodeId(nodeId) || nodeData.vocalSplit != null;
}

// ── 业务载荷 ──────────────────────────────────────────────────────────────────

/** 场景切分创建载荷（业务键；canvas_binding/client_token 由运行时与 create 注入）。 */
export interface SceneSplitTaskPayload {
  source_asset_id: string;
  target_node_id: string;
  granularity: SceneSplitGranularity;
}

/** 人声分离创建载荷（业务键）。 */
export interface VocalSplitTaskPayload {
  source_asset_id: string;
  scene: VocalSplitScene;
  output_format: VocalSplitFormat;
}

/** 创建响应的 canvas_binding 回执视图（QY 后端；类型宽松读取，不改共享 API 形状）。 */
type CreatedWithBinding = { job_id: string; canvas_binding?: CreateJobOutcome['canvasBinding'] };

/** 场景切分任务类型定义（恢复记录 task_type = video_scene_split）。 */
export const sceneSplitTask: GenerationTaskDefinition<SceneSplitTaskPayload> = {
  taskTypes: ['video_scene_split'],

  identify: isSceneSplitCard,

  frozenInput(_nodeId, nodeData) {
    const identity = nodeData.sceneSplit as SceneSplitIdentity | undefined;
    return identity?.lastInput ?? null; // 恢复补卡无业务参数 → 不可信，保留卡片提示重新编辑
  },

  async create(projectId, input: TaskSubmissionInput<SceneSplitTaskPayload>, binding, key) {
    // client_token 幂等承载 = submission_id（QY 契约一致性）；canvas_binding 走 body 协议键
    //（服务端剥离后再做业务 strict 校验）；历史兼容提交不带绑定、token 每次新生成
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
    // 契约校验后 1 段也照常扇出（第 1 段全程时间轴）；result 缺失（畸形/契约前）同样走
    // 投影路径——服务端投影 invalid 时保留占位卡，不落入一对一 primary 转换
    return detail.result == null || (detail.result.segments?.length ?? 0) > 0;
  },

  planRecovery: (record, host) => multiResultPlanRecovery(record, host, {
    mediaType: 'video',
    identityKey: 'sceneSplit',
    edgeOrigin: SCENE_SPLIT_EDGE_ORIGIN,
  }),

  planFanoutCards: planSceneSplitFanoutCards,
};

/** 人声分离任务类型定义（恢复记录 task_type = vocal_split）。 */
export const vocalSplitTask: GenerationTaskDefinition<VocalSplitTaskPayload> = {
  taskTypes: ['vocal_split'],

  identify: isVocalSplitCard,

  frozenInput(_nodeId, nodeData) {
    const identity = nodeData.vocalSplit as VocalSplitIdentity | undefined;
    return identity?.lastInput ?? null;
  },

  async create(projectId, input: TaskSubmissionInput<VocalSplitTaskPayload>, binding, key) {
    // 幂等承载 = Idempotency-Key 头（须等于 submission_id）；历史兼容不带（行为零变化）
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

// ── 恢复落卡规划（两家族共用心智：投影/续轮询/补占位，镜像 normalGeneration） ──────

interface MultiResultPlanOptions {
  mediaType: 'video' | 'audio';
  /** 占位卡补建时写入的家族身份键（无业务参数，仅占位；null 不写）。 */
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
          url: '', // 产物 URL 由运行时拉任务详情补齐
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
    // 受理回执丢失 + 已失败：补失败卡（恢复卡无业务参数，重试提示重新编辑）
    return { kind: 'restore-target', node: buildMultiResultTargetNode(record, options), edges: recoverySourceEdges(record, host, options.edgeOrigin) };
  }
  return { kind: 'none' };
}

/** 受理回执丢失补占位卡：按恢复种子几何 + 家族媒体形态（不伪造业务参数/恢复项标记）。 */
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

/** 补占位卡的来源线：种子来源快照中仍在画布的源卡（不伪造悬空边）。 */
function recoverySourceEdges(record: GenerationRecoveryRecord, host: GenerationRuntimeHost, origin: string) {
  const sources = record.recovery_seed?.sources ?? [];
  return sources
    .filter((source) => host.findNode(source.node_id) != null)
    .map((source) => ({ source: source.node_id, target: record.target_node_id, origin }));
}

// ── 扇出落卡（既有排列规则与来源线；规范 node_id 与 marker 由运行时写入） ──────────

/** 媒体节点占位盒（内容区 + 标题 44，口径同页面 nodeBoxOf 媒体分支）。 */
function nodeBoxOf(node: { position: { x: number; y: number }; data?: Record<string, unknown> }): {
  x: number; y: number; width: number; height: number;
} {
  const box = sceneSplitSegmentBox({ width: numberOf(node.data?.width), height: numberOf(node.data?.height) });
  return { x: node.position.x, y: node.position.y, width: box.width, height: box.height };
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/** 占位卡入边的源卡（发送时拉的 origin 来源线；扇出后改拉 源卡→结果卡）。 */
function fanoutSourceNode(ctx: FanoutContext) {
  const anchorId = ctx.anchor?.id;
  if (anchorId == null) return null;
  const sourceEdge = ctx.host.getEdges().find((edge) => edge.target === anchorId);
  return sourceEdge ? ctx.host.findNode(sourceEdge.source) : null;
}

/** 场景切分扇出：源卡右侧网格避让布局 + 「第 N 段 起止时间」命名 + 段资产宽高（IKH8C1 口径）。 */
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
        jobId: ctx.jobId, // 段卡保留 jobId（MediaNode 生成宿主 target Handle 渲染来源线）
      },
    };
  });
  const edges = source
    ? nodes.map((node) => ({ source: source.id, target: node.id, origin: SCENE_SPLIT_EDGE_ORIGIN }))
    : [];
  return { nodes, edges };
}

/** 人声分离扇出：占位卡列位纵向轨列（内容区高 240 + 间距 60）+ 「源名(轨词).格式」命名（IKHA30 口径）。 */
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
      // 轨卡不带 jobId（IKHA30 口径：水合不为轨卡开轮询；marker 承担恢复身份）
    },
  }));
  const source = fanoutSourceNode(ctx);
  const edges = source
    ? nodes.map((node) => ({ source: source.id, target: node.id, origin: VOCAL_SPLIT_EDGE_ORIGIN }))
    : [];
  return { nodes, edges };
}
