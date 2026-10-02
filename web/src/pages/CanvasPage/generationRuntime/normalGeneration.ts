/* ============================================
 * 普通生成任务类型定义（IKJJR1 首批接入）：图片/视频/音频主生成 + 生成输出槽。
 * 差异承载：身份识别（排除工具家族的卡）、服务端冻结输入（通用重试端点）、
 * 创建/重试/取消三请求、成功落卡投影（一对一 / slot: 多结果扇出）、恢复落卡规划。
 * ============================================ */
import { createGenerationJob, retryGenerationJob, cancelGenerationJob, type CreateJobPayload } from '@/api/jobs';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { isAudioMixNodeId } from '../audioMix';
import { isAudioSpeedNodeId } from '../audioSpeed';
import { isAudioTrimNodeId } from '../audioTrim';
import { isMediaExtractNodeId } from '../mediaExtract';
import { isVocalSplitNodeId } from '../vocalSplit';
import { audioVideoMuxIdentityOf } from '../audioVideoMux';
import type { Node } from '@xyflow/react';
import type {
  CreateJobOutcome, GenerationRuntimeHost, GenerationTaskDefinition, RecoveryCardPlan, TaskSubmissionInput,
} from './types';

const TARGET_OUTPUT_KEY = '$target';

/** 卡片 data 上承载工具家族身份的键——出现任一即非普通生成卡。 */
const TOOL_IDENTITY_KEYS = [
  'imageEnhance', 'videoEnhance', 'frameInterpolation', 'imageErase', 'videoSubtitleErase',
  'imageCutout', 'imageOutpaint', 'vocalSplit', 'sceneSplit', 'smartMatting', 'mediaExtract',
  'audioTrim', 'audioSpeed', 'audioVideoMux',
] as const;

/** 普通生成身份：媒体卡 + 关联任务 + 无任何工具家族身份（含节点 id 前缀家族）。 */
export function isNormalGenerationCard(nodeId: string, nodeData: Record<string, unknown>): boolean {
  if (nodeData.jobId == null) return false;
  if (isAudioMixNodeId(nodeId) || isMediaExtractNodeId(nodeId) || isAudioTrimNodeId(nodeId)
    || isAudioSpeedNodeId(nodeId) || isVocalSplitNodeId(nodeId)) return false;
  if (audioVideoMuxIdentityOf({ data: nodeData } as Node) != null) return false;
  return TOOL_IDENTITY_KEYS.every((key) => nodeData[key] == null);
}

/** 输出槽卡身份（B.4 已有多输出槽）：generation-output:<slot_id>。 */
export const OUTPUT_SLOT_NODE_PREFIX = 'generation-output:';

export function outputSlotNodeId(slotId: string | number): string {
  return `${OUTPUT_SLOT_NODE_PREFIX}${slotId}`;
}

/** 创建载荷（业务部分）：页面提交时机组好（含 prompt 组装/样片确认字段）。 */
export type NormalGenerationPayload = CreateJobPayload;

/** 普通生成任务类型定义（恢复记录按 task_type 三值分派）。 */
export const normalGenerationTask: GenerationTaskDefinition<NormalGenerationPayload> = {
  taskTypes: ['image', 'video', 'audio'],

  identify: isNormalGenerationCard,

  // 普通生成冻结输入在服务端（retry 端点按原任务快照重放）——不实现 frozenInput（undefined）。

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
    // 通用重试：服务端按原任务冻结输入为缺失/失败输出建新任务；携带 canvas_binding 时
    // 新 submission_id 独立承接（原卡在途锁与归属由运行时管理）。历史兼容路径保持旧三参调用形状。
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
            mediaType: mediaTypeOfTask(record.task_type),
          })),
        },
      };
    }
    if (jobStatus === 'queued' || jobStatus === 'processing' || jobStatus === 'checking') {
      if (!targetExists) return { kind: 'restore-target', node: buildRecoveryTargetNode(record) };
      return { kind: 'resume-polling' };
    }
    if (jobStatus === 'failed' && !targetExists) {
      // 受理回执丢失 + 已失败：补失败卡（可按服务端冻结输入重试），不静默吞掉入口
      return { kind: 'restore-target', node: buildRecoveryTargetNode(record) };
    }
    return { kind: 'none' };
  },
};

/** task_type → 媒体类型。 */
export function mediaTypeOfTask(taskType: string): 'image' | 'video' | 'audio' {
  if (taskType === 'video') return 'video';
  if (taskType === 'audio') return 'audio';
  return 'image';
}

/** 受理回执丢失补卡：按恢复种子/原目标快照恢复目标卡（媒体占位形态，jobId 续上）。 */
export function buildRecoveryTargetNode(record: GenerationRecoveryRecord): {
  id: string; type: 'mediaNode'; position: { x: number; y: number }; data: Record<string, unknown>;
} {
  const mediaType = mediaTypeOfTask(record.task_type);
  const seed = record.recovery_seed?.target;
  const snapshot = record.previous_target_snapshot;
  const position = seed
    ? { x: seed.x, y: seed.y }
    : readSnapshotPosition(snapshot) ?? { x: 0, y: 0 };
  const label = mediaType === 'video' ? '视频' : mediaType === 'audio' ? '音频' : '图片';
  const fileName = seed?.name
    || (typeof snapshot?.data === 'object' && snapshot.data !== null
      ? String((snapshot.data as Record<string, unknown>).fileName ?? '') : '')
    || `${label}生成中`;
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
      ...(failed && failText ? { errorText: failText } : {}),
      ...(seed && seed.width > 0 && seed.height > 0 ? { width: seed.width, height: seed.height } : {}),
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

