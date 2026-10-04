/* ============================================
 * 混合与合成任务类型定义（IKJJR4，IKIXK9-SPEC-20261002 A 节）：
 *  - audio_mix（音频混合）：结果占位卡承接（预分配节点 id = target_node_id，jobId 受理后回填），
 *    专属重试 POST /audio-mixes/:jobId/retry 复用 jobId。
 *  - audio_video_mux（音视频合成）：原草稿卡承接（角色 draft，取消后 settleTarget 回草稿可再生成），
 *    专属重试 POST /audio-video-muxes/:jobId/retry 复用 jobId。
 * 差异承载：身份识别（节点 id 前缀 / data 身份键）、创建/专属重试/取消三请求、恢复落卡规划。
 * 冻结输入在服务端（retry 端点按原任务快照重放）——不实现 frozenInput。
 * ============================================ */
import {
  createAudioMix, retryAudioMix, createAudioVideoMux, retryAudioVideoMux,
  cancelGenerationJob, type CreateAudioVideoMuxPayload, type DedicatedRetryCreatedData,
} from '@/api/jobs';
import type { AudioMixCreate } from '@lib/contracts/audio-mix';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { isAudioMixNodeId, buildAudioMixPlaceholderNode, AUDIO_MIX_FORMATS, type AudioMixFormat } from '../audioMix';
import { audioVideoMuxIdentityOf, buildAudioVideoMuxPlaceholderNode } from '../audioVideoMux';
import type { Node } from '@xyflow/react';
import type {
  CreateJobOutcome, GenerationRuntimeHost, GenerationTaskDefinition, RecoveryCardPlan,
  RuntimeNodeView, TaskSubmissionInput,
} from './types';

const TARGET_OUTPUT_KEY = '$target';

/* ── 会话桥（IKIXK8 提交交接）──────────────────────────
 * compound 会话（audioMix/audioVideoMux）的 createTask 需感知运行时创建结果：
 * 受理成功才退会话、失败留在面板按原参数重发（规格 A.3「创建失败后的编辑界面
 * 再次发送归会话层」）。runtime.submit 是同步受理发出（fire-and-forget），故由
 * def.create 在受理/失败时各回调一次。key = 目标节点 id。
 * 409 canvas_binding_conflict 与其他创建失败同路径桥一次 failed（IKJKU1：运行时
 * 不自动重发），会话留在面板由用户复核后再发（新意图 = 新 submission_id）。 */
type MixSubmitWatcher = { accepted(jobId: string): void; failed(error: unknown): void };
const submitWatchers = new Map<string, MixSubmitWatcher>();

/** 页面宿主提交前登记；返回解除函数（未发出/已结算时收尾）。 */
export function watchMixSubmit(nodeId: string, watcher: MixSubmitWatcher): () => void {
  submitWatchers.set(nodeId, watcher);
  return () => { if (submitWatchers.get(nodeId) === watcher) submitWatchers.delete(nodeId); };
}

function signalAccepted(nodeId: string, jobId: string): void {
  const watcher = submitWatchers.get(nodeId);
  submitWatchers.delete(nodeId);
  watcher?.accepted(jobId);
}
function signalFailed(nodeId: string, error: unknown): void {
  const watcher = submitWatchers.get(nodeId);
  submitWatchers.delete(nodeId);
  watcher?.failed(error);
}

/** 专属重试响应 → CreateJobOutcome（jobId 复用；绑定视图随受理返回，可空 = 历史路径）。 */
function dedicatedRetryOutcome(retried: DedicatedRetryCreatedData, jobId: string | number): CreateJobOutcome {
  if (String(retried.job_id) !== String(jobId)) {
    // 专属重试协议破坏（服务端必须复用同 jobId；同 jobId ≠ 同提交意图，隔离靠 submission_id）
    throw new Error('重试任务身份不一致');
  }
  return { jobId: retried.job_id, canvasBinding: retried.canvas_binding ?? null };
}

/* ── 恢复落卡规划（B.4/B.5）────────────────────────── */

/** 恢复落卡位置：服务端原目标快照（已保存编辑，B.3）优先；恢复种子仅无快照时回退。 */
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

/** 混合恢复补卡：种子名「混合结果.<format>」解析输出格式（缺省 mp3）。 */
function mixFormatOf(name: string | undefined): AudioMixFormat {
  const dot = typeof name === 'string' ? name.lastIndexOf('.') : -1;
  const ext = dot > 0 ? name!.slice(dot + 1).toLowerCase() : '';
  return (AUDIO_MIX_FORMATS as readonly string[]).includes(ext) ? ext as AudioMixFormat : 'mp3';
}

/** 混合/合成恢复规划（同 normalGeneration 形状，卡数据按家族）：
 *  进行中缺卡补占位、在卡续轮询、成功未应用走扇出投影、失败缺卡补失败卡可重试。 */
function planMixMuxRecovery(
  record: GenerationRecoveryRecord,
  host: GenerationRuntimeHost,
  mediaType: 'audio' | 'video',
  buildRestore: (record: GenerationRecoveryRecord) => RuntimeNodeView | null,
): RecoveryCardPlan {
  const targetExists = host.findNode(record.target_node_id) != null;
  const jobStatus = record.job?.status;
  // present 且卡仍在画布 = 已应用在场（B.3 一对一成品卡保护）：不扇出；pending 一律待应用。
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
          url: '', // 产物 URL 由运行时拉任务详情补齐
          mediaType,
        })),
      },
    };
  }
  if (jobStatus === 'queued' || jobStatus === 'processing' || jobStatus === 'checking') {
    if (!targetExists) {
      const node = buildRestore(record);
      if (node) return { kind: 'restore-target', node };
    }
    return { kind: 'resume-polling' };
  }
  if (jobStatus === 'failed' && !targetExists) {
    const node = buildRestore(record);
    if (node) return { kind: 'restore-target', node };
  }
  return { kind: 'none' };
}

/* ── 音频混合（audio_mix）────────────────────────── */

/** 音频混合任务定义（恢复记录按 task_type=audio_mix 分派）。 */
export const audioMixTask: GenerationTaskDefinition<AudioMixCreate> = {
  taskTypes: ['audio_mix'],

  identify(nodeId, nodeData) {
    return isAudioMixNodeId(nodeId) && nodeData.jobId != null;
  },

  async create(projectId, input: TaskSubmissionInput<AudioMixCreate>, binding, key) {
    const nodeId = input.target!.targetNodeId;
    try {
      const created = await createAudioMix(
        projectId,
        binding ? { ...input.payload, canvas_binding: binding } : input.payload,
        { silent: true, idempotencyKey: key },
      );
      signalAccepted(nodeId, created.job_id);
      return {
        jobId: created.job_id,
        canvasBinding: (created as { canvas_binding?: CreateJobOutcome['canvasBinding'] }).canvas_binding ?? null,
      };
    } catch (e) {
      signalFailed(nodeId, e);
      throw e;
    }
  },

  async retry(projectId, jobId, _nodeData, binding, key) {
    // 专属重试：服务端按原任务冻结输入重放、复用 jobId；携 canvas_binding 时新
    // submission_id（= 幂等键）为独立提交意图，同 jobId 旧执行不更新新提交。
    const retried = await retryAudioMix(projectId, jobId, key, { silent: true }, binding ?? undefined);
    return dedicatedRetryOutcome(retried, jobId);
  },

  async cancel(projectId, jobId) {
    return cancelGenerationJob(projectId, jobId);
  },

  planRecovery(record, host) {
    return planMixMuxRecovery(record, host, 'audio', (rec) => {
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
  },
};

/* ── 音视频合成（audio_video_mux）────────────────────────── */

/** 音视频合成任务定义（恢复记录按 task_type=audio_video_mux 分派）。 */
export const audioVideoMuxTask: GenerationTaskDefinition<CreateAudioVideoMuxPayload> = {
  taskTypes: ['audio_video_mux'],

  identify(nodeId, nodeData) {
    // data.audioVideoMux 身份键 + 已受理 jobId（未发送草稿卡无 jobId，不归运行时）
    if (nodeData.jobId == null) return false;
    return audioVideoMuxIdentityOf({ id: nodeId, type: 'mediaNode', data: nodeData } as Node) != null;
  },

  async create(projectId, input: TaskSubmissionInput<CreateAudioVideoMuxPayload>, binding, key) {
    const nodeId = input.target!.targetNodeId;
    try {
      const created = await createAudioVideoMux(
        projectId,
        binding ? { ...input.payload, canvas_binding: binding } : input.payload,
        { silent: true, idempotencyKey: key },
      );
      signalAccepted(nodeId, created.job_id);
      return {
        jobId: created.job_id,
        canvasBinding: (created as { canvas_binding?: CreateJobOutcome['canvasBinding'] }).canvas_binding ?? null,
      };
    } catch (e) {
      signalFailed(nodeId, e);
      throw e;
    }
  },

  async retry(projectId, jobId, _nodeData, binding, key) {
    // 专属重试：服务端按冻结快照重放（音频/视频/参数/画布来源全部沿用首次提交）、
    // 复用 jobId；携 canvas_binding 时新 submission_id 隔离前端操作轮次。
    const retried = await retryAudioVideoMux(projectId, jobId, key, { silent: true }, binding ?? undefined);
    return dedicatedRetryOutcome(retried, jobId);
  },

  async cancel(projectId, jobId) {
    return cancelGenerationJob(projectId, jobId);
  },

  planRecovery(record, host) {
    return planMixMuxRecovery(record, host, 'video', (rec) => {
      // 合成身份随受理时服务端保存的原目标快照恢复（剥离了活跃任务字段与 marker）
      const snapshotData = rec.previous_target_snapshot?.data;
      const identity = audioVideoMuxIdentityOf({
        id: rec.target_node_id,
        type: 'mediaNode',
        data: (snapshotData != null && typeof snapshotData === 'object' ? snapshotData : {}) as Record<string, unknown>,
      } as Node);
      if (identity == null) return null; // 身份不可信不猜卡（A.6 口径）
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
