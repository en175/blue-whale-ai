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

const IMAGE_TOOL_IDENTITY_KEYS = ['imageEnhance', 'imageErase', 'imageCutout', 'imageOutpaint'] as const;
type ImageToolIdentityKey = (typeof IMAGE_TOOL_IDENTITY_KEYS)[number];

const FROZEN_INPUT_KEYS: Record<ImageToolIdentityKey, 'lastParams' | 'lastInput'> = {
  imageEnhance: 'lastParams',
  imageOutpaint: 'lastParams',
  imageErase: 'lastInput',
  imageCutout: 'lastInput',
};

export function isImageToolsCard(_nodeId: string, nodeData: Record<string, unknown>): boolean {
  return IMAGE_TOOL_IDENTITY_KEYS.some((key) => nodeData[key] != null);
}

export type ImageToolsPayload =
  | { kind: 'imageEnhance'; input: ImageEnhanceInput }
  | { kind: 'imageErase'; input: ImageEraseInput }
  | { kind: 'imageCutout'; input: ImageCutoutInput }
  | { kind: 'imageOutpaint'; input: ImageOutpaintInput };

export type ImageToolsAcceptanceNotifier = (
  nodeId: string,
  settled: { jobId: string } | { error: unknown },
) => void;

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

function trustworthyFrozenInput(nodeId: string, nodeData: Record<string, unknown>) {
  const frozen = readFrozenInput(nodeData);
  if (frozen == null) return null;
  if (typeof frozen.input.source_asset_id !== 'string' || frozen.input.source_asset_id.length === 0) return null;
  if (frozen.input.target_node_id !== nodeId) return null;
  return frozen;
}

export function imageToolsRetryPayloadOf(nodeId: string, nodeData: Record<string, unknown>): ImageToolsPayload | null {
  const frozen = trustworthyFrozenInput(nodeId, nodeData);
  if (frozen == null) return null;
  if (frozen.kind === 'imageEnhance') return { kind: 'imageEnhance', input: frozen.input as unknown as ImageEnhanceInput };
  if (frozen.kind === 'imageErase') return { kind: 'imageErase', input: frozen.input as unknown as ImageEraseInput };
  if (frozen.kind === 'imageCutout') return { kind: 'imageCutout', input: frozen.input as unknown as ImageCutoutInput };
  return { kind: 'imageOutpaint', input: frozen.input as unknown as ImageOutpaintInput };
}

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

    async retry(projectId, _jobId, ctx, binding, key) {
      const frozen = readFrozenInput(ctx.nodeData);
      if (frozen == null) throw new Error('原任务输入已不可信');
      const created = await createByKind(frozen.kind, projectId, frozen.input, binding, key);
      notifyAccepted?.(frozen.input.target_node_id as string, { jobId: created.jobId });
      return created satisfies CreateJobOutcome;
    },

    async cancel(projectId, jobId) {
      return cancelGenerationJob(projectId, jobId);
    },

    planRecovery(record: GenerationRecoveryRecord, host: GenerationRuntimeHost): RecoveryCardPlan {
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
