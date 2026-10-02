/* ============================================
 * 图像工具任务类型定义（IKJJR2 第二批接入）：擦除 / 抠图 / 扩图 / 图像高清。
 * 差异承载：四键身份识别（data.imageErase / imageCutout / imageOutpaint / imageEnhance）、
 * 客户端冻结输入（lastInput / lastParams 随提交写入卡，失败重试原样重发创建端点——
 * 四工具契约无 retry 端点，与普通生成的服务端冻结重试不同）、创建/取消请求、
 * 恢复落卡规划（复用普通生成的单结果规划——四工具都是一对一目标承接）。
 * ============================================ */
import {
  createImageEnhancement, createImageErase, createImageCutout, createImageOutpaint,
  cancelGenerationJob, type ImageToolBindingView, type ImageToolCreateInit,
} from '@/api/jobs';
import type { CanvasBinding, GenerationRecoveryRecord } from '@/api/canvasRecovery';
import type { ImageEnhanceInput } from '@lib/contracts/image-enhance';
import type { ImageEraseInput } from '@lib/contracts/image-erase';
import type { ImageCutoutInput } from '@lib/contracts/image-cutout';
import type { ImageOutpaintInput } from '@lib/contracts/image-outpaint';
import { normalGenerationTask } from './normalGeneration';
import type {
  CreateJobOutcome, GenerationRuntimeHost, GenerationTaskDefinition, RecoveryCardPlan, TaskSubmissionInput,
} from './types';

/** 卡片 data 上承载本家族身份的四键（videoEnhance / videoSubtitleErase 等归姊妹家族）。 */
const IMAGE_TOOL_IDENTITY_KEYS = ['imageEnhance', 'imageErase', 'imageCutout', 'imageOutpaint'] as const;
type ImageToolIdentityKey = (typeof IMAGE_TOOL_IDENTITY_KEYS)[number];

/** 冻结输入的键位差异：高清/扩图随 lastParams，擦除/抠图随 lastInput（提交时写入 identity）。 */
const FROZEN_INPUT_KEYS: Record<ImageToolIdentityKey, 'lastParams' | 'lastInput'> = {
  imageEnhance: 'lastParams',
  imageOutpaint: 'lastParams',
  imageErase: 'lastInput',
  imageCutout: 'lastInput',
};

/** 图像工具身份：卡 data 带四键任一（含未提交的草稿卡——cancel/remove 对无 jobId 卡退回原路径）。 */
export function isImageToolsCard(_nodeId: string, nodeData: Record<string, unknown>): boolean {
  return IMAGE_TOOL_IDENTITY_KEYS.some((key) => nodeData[key] != null);
}

/** 提交载荷：页面按工具提交时机组好的契约 input（target_node_id 已含且 = 承接目标卡）。
 *  kind 用卡 data 身份键风格（与 createByKind 分派键一致；taskTypes 才是服务端 task_type 值）。 */
export type ImageToolsPayload =
  | { kind: 'imageEnhance'; input: ImageEnhanceInput }
  | { kind: 'imageErase'; input: ImageEraseInput }
  | { kind: 'imageCutout'; input: ImageCutoutInput }
  | { kind: 'imageOutpaint'; input: ImageOutpaintInput };

/** 受理 settle 通知（页面持有）：工具会话的 createTask/startTask 靠它等待受理结果，
 *  保持 IKIXK8 的失败反馈（onError）与受理后建卡时机（擦除/抠图 handoff）。
 *  只在 def.create 的请求 settle 时触发——不承诺运行时归属检查通过。 */
export type ImageToolsAcceptanceNotifier = (
  nodeId: string,
  settled: { jobId: string } | { error: unknown },
) => void;

/** 卡 data → 冻结输入原文（不判可信；缺身份/缺键返回 null）。 */
function readFrozenInput(nodeData: Record<string, unknown>): { kind: ImageToolIdentityKey; input: Record<string, unknown> } | null {
  for (const key of IMAGE_TOOL_IDENTITY_KEYS) {
    const identity = nodeData[key];
    if (identity == null || typeof identity !== 'object') continue;
    const frozen = (identity as Record<string, unknown>)[FROZEN_INPUT_KEYS[key]];
    if (frozen != null && typeof frozen === 'object') {
      return { kind: key, input: frozen as Record<string, unknown> };
    }
  }
  return null;
}

/** 冻结输入可信三要素（A.6）：源素材身份 + 承接目标即本卡；缺失 → null（保留失败卡，
 *  不读取新会话、不补猜测默认值——历史卡回落默认参数重发的旧行为是本票明确修正项）。 */
function trustworthyFrozenInput(nodeId: string, nodeData: Record<string, unknown>) {
  const frozen = readFrozenInput(nodeData);
  if (frozen == null) return null;
  if (typeof frozen.input.source_asset_id !== 'string' || frozen.input.source_asset_id.length === 0) return null;
  if (frozen.input.target_node_id !== nodeId) return null;
  return frozen;
}

/** 失败卡重试载荷（页面无 jobId 路径用——首次创建失败无任务身份，不能走 runtime.retry）：
 *  可信冻结输入 → 提交载荷；不可信 → null（调用方保留卡并提示重新编辑）。 */
export function imageToolsRetryPayloadOf(nodeId: string, nodeData: Record<string, unknown>): ImageToolsPayload | null {
  const frozen = trustworthyFrozenInput(nodeId, nodeData);
  if (frozen == null) return null;
  if (frozen.kind === 'imageEnhance') return { kind: 'imageEnhance', input: frozen.input as unknown as ImageEnhanceInput };
  if (frozen.kind === 'imageErase') return { kind: 'imageErase', input: frozen.input as unknown as ImageEraseInput };
  if (frozen.kind === 'imageCutout') return { kind: 'imageCutout', input: frozen.input as unknown as ImageCutoutInput };
  return { kind: 'imageOutpaint', input: frozen.input as unknown as ImageOutpaintInput };
}

/** 按载荷类型发对应创建端点（binding/key 由运行时注入；silent 统一——HTTP 提示归
 *  会话 onError / 运行时失败卡，不双提示）。 */
async function createByKind(
  kind: ImageToolIdentityKey,
  projectId: string,
  input: Record<string, unknown>,
  binding: CanvasBinding | null,
  key: string,
): Promise<{ jobId: string; canvasBinding: ImageToolBindingView | null }> {
  const init: ImageToolCreateInit = binding && key
    ? { silent: true, canvasBinding: binding, idempotencyKey: key }
    : { silent: true };
  const created = kind === 'imageEnhance'
    ? await createImageEnhancement(projectId, input as unknown as ImageEnhanceInput, init)
    : kind === 'imageErase'
      ? await createImageErase(projectId, input as unknown as ImageEraseInput, init)
      : kind === 'imageCutout'
        ? await createImageCutout(projectId, input as unknown as ImageCutoutInput, init)
        : await createImageOutpaint(projectId, input as unknown as ImageOutpaintInput, init);
  return { jobId: created.job_id, canvasBinding: created.canvas_binding ?? null };
}

/** 图像工具任务类型定义（恢复记录按 task_type 四值分派）。 */
export function createImageToolsTask(notifyAccepted?: ImageToolsAcceptanceNotifier): GenerationTaskDefinition<ImageToolsPayload> {
  return {
    taskTypes: ['image_erase', 'image_cutout', 'image_outpaint', 'image_enhance'],

    identify: isImageToolsCard,

    frozenInput(nodeId, nodeData) {
      return trustworthyFrozenInput(nodeId, nodeData);
    },

    async create(projectId, input: TaskSubmissionInput<ImageToolsPayload>, binding, key) {
      const { kind, input: toolInput } = input.payload;
      const nodeId = input.target!.targetNodeId;
      try {
        const created = await createByKind(kind, projectId, toolInput as unknown as Record<string, unknown>, binding, key);
        notifyAccepted?.(nodeId, { jobId: created.jobId });
        return created satisfies CreateJobOutcome;
      } catch (e) {
        notifyAccepted?.(nodeId, { error: e });
        throw e;
      }
    },

    async retry(projectId, _jobId, nodeData, binding, key) {
      // 四工具契约无 retry 端点（A.5 工具重新提交保持原协议）：冻结输入原样重发创建端点。
      // runtime 已保证 frozenInput 非 null（可信）才进到这里；此处再读一次原文。
      const frozen = readFrozenInput(nodeData);
      if (frozen == null) throw new Error('原任务输入已不可信');
      const created = await createByKind(frozen.kind, projectId, frozen.input, binding, key);
      notifyAccepted?.(frozen.input.target_node_id as string, { jobId: created.jobId });
      return created satisfies CreateJobOutcome;
    },

    async cancel(projectId, jobId) {
      return cancelGenerationJob(projectId, jobId);
    },

    planRecovery(record: GenerationRecoveryRecord, host: GenerationRuntimeHost): RecoveryCardPlan {
      // 四工具都是单结果一对一承接：恢复规划与普通生成同构（补卡 fileName 取 seed.name——
      // 提交时快照的「高清/擦除/抠图/扩图」卡名）。补卡时按恢复种子来源补来源线
      //（种子只列实际画布节点；源卡已删的不伪造悬空边——B.3）。
      const plan = normalGenerationTask.planRecovery!(record, host);
      if (plan.kind === 'restore-target') {
        plan.edges = (record.recovery_seed?.sources ?? [])
          .map((source) => (host.findNode(source.node_id) != null
            ? { source: source.node_id, target: record.target_node_id }
            : null))
          .filter((edge): edge is { source: string; target: string } => edge != null);
      }
      return plan;
    },
  };
}
