import type { MutableRefObject, RefObject } from 'react';
import type { Node } from '@xyflow/react';
import { toast as globalToast } from 'sonner';
import type { ImageOutpaintInput } from '@lib/contracts/image-outpaint';
import { uploadAssetFile } from '@/utils/upload';
import { newNodeId } from '../nodeId';
import { imageToolTargetBesideSource } from '../canvasPureNodeHelpers';
import { hasCustomName } from '../canvasNodeUtils';
import { isSilentAuthError } from '../toolSessionCapture';
import { imageEnhanceDraftPosition } from '../imageEnhance';
import { IMAGE_ERASE_EDGE_ORIGIN, rasterizeMaskToPngFile } from '../imageErase';
import { IMAGE_CUTOUT_EDGE_ORIGIN } from '@lib/contracts/image-cutout';
import { VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN } from '@lib/contracts/video-subtitle-erase';
import { IMAGE_OUTPAINT_EDGE_ORIGIN, buildImageOutpaintInput, type ImageOutpaintIdentity } from '../imageOutpaint';
import type { OutpaintFrozenInput, OutpaintTaskSubmission, CutoutSubmission } from '../imageToolSessions';
import type { ImageEraseTaskSubmission, SubtitleEraseTaskSubmission } from '../maskToolSessions';
import type { ImageEnhanceSubmission } from '../panelToolSessions';
import type { CanvasToolHosts } from '../canvasToolSessions';
import { createImageToolsTask, type ImageToolsPayload } from '../generationRuntime/imageTools';
import { videoToolsTask, type VideoToolPayload } from '../generationRuntime/videoTools';
import { seedTargetOfNode, seedSourcesOfNode } from '../generationRuntime/seedFacts';
import type { RecoverySeedSource, RecoverySeedTarget, RuntimeNodeView } from '../generationRuntime/types';
import type { GenerationRuntime, GenerationRuntimeHost } from '../generationRuntime/runtime';
import type { CanvasDraftCardCreatorsHandles } from './useCanvasDraftCardCreators';

type ImageToolTarget = {
  targetNodeId: string;
  seedTarget: RecoverySeedTarget;
  seedSources: RecoverySeedSource[];
};

type ImageToolsAcceptance = Map<string, { resolve: (jobId: string) => void; reject: (e: unknown) => void }>;

export interface CanvasImageToolHostsHost {
  currentId: string;
  mediaNodesRef: RefObject<Node[]>;
  generationRuntimeRef: RefObject<GenerationRuntime | null>;
  generationRuntimeHostRef: RefObject<GenerationRuntimeHost | null>;
  imageToolsTask: ReturnType<typeof createImageToolsTask>;
  imageToolsAcceptanceRef: RefObject<ImageToolsAcceptance>;
  creators: Pick<CanvasDraftCardCreatorsHandles, 'createImageDraftCard'>;
  addCanvasEdge: (source: string, target: string, refRole: undefined, marker: Record<string, unknown>) => void;
  removeCanvasNodes: (ids: string[]) => void;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  clearPickState: () => void;
  toolHostsRef: MutableRefObject<Partial<CanvasToolHosts>>;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

export interface CanvasImageToolHostsHandles {
  imageToolTargetOfNode: (nodeId: string) => ImageToolTarget | null;
  dispatchImageToolTask: (payload: ImageToolsPayload, target: ImageToolTarget) => Promise<string>;
  startImageEnhanceJob: (submission: ImageEnhanceSubmission, silent?: boolean) => Promise<void>;
  submitVideoToolTask: (payload: VideoToolPayload, targetNodeId: string, options?: Parameters<GenerationRuntime['submit']>[2]) => boolean;
  handleCancelJob: (nodeId: string) => void;
  outpaint: CanvasToolHosts['outpaint'];
  erase: CanvasToolHosts['erase'];
  subtitleErase: CanvasToolHosts['subtitleErase'];
  cutout: CanvasToolHosts['cutout'];
}

export function useCanvasImageToolHosts(host: CanvasImageToolHostsHost): CanvasImageToolHostsHandles {
  const {
    currentId,
    mediaNodesRef,
    generationRuntimeRef,
    generationRuntimeHostRef,
    imageToolsTask,
    imageToolsAcceptanceRef,
    creators,
    addCanvasEdge,
    removeCanvasNodes,
    patchMediaNode,
    clearPickState,
    toolHostsRef,
    showToast,
  } = host;
  const { createImageDraftCard } = creators;

  const imageToolTargetOfNode = (nodeId: string): ImageToolTarget | null => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return null;
    const runtimeHost = generationRuntimeHostRef.current;
    return {
      targetNodeId: nodeId,
      seedTarget: seedTargetOfNode(node as unknown as RuntimeNodeView),
      seedSources: runtimeHost ? seedSourcesOfNode(nodeId, runtimeHost) : [],
    };
  };
  const dispatchImageToolTask = (
    payload: ImageToolsPayload,
    target: ImageToolTarget,
  ): Promise<string> => {
    const runtime = generationRuntimeRef.current;
    if (!runtime) return Promise.reject(new Error('生成任务运行时未就绪'));
    return new Promise<string>((resolve, reject) => {
      imageToolsAcceptanceRef.current.set(target.targetNodeId, { resolve, reject });
      const dispatched = runtime.submit(
        imageToolsTask,
        {
          payload,
          target: { ...target, expectedBindingRevision: runtime.bindingRevisionOf(target.targetNodeId) },
        },
        {
          onCreateFailure: (e: unknown) => { reject(e); return false; },
        },
      );
      if (!dispatched) {
        imageToolsAcceptanceRef.current.delete(target.targetNodeId);
        reject(new Error('任务提交中，请勿重复发送'));
      }
    });
  };
  const submitVideoToolTask = (
    payload: VideoToolPayload,
    targetNodeId: string,
    options?: Parameters<GenerationRuntime['submit']>[2],
  ): boolean => {
    const runtime = generationRuntimeRef.current;
    const runtimeHost = generationRuntimeHostRef.current;
    const node = mediaNodesRef.current.find((n) => n.id === targetNodeId);
    if (!runtime || !runtimeHost || !node) return false;
    return runtime.submit(
      videoToolsTask,
      {
        payload,
        target: {
          targetNodeId,
          seedTarget: seedTargetOfNode(node as unknown as RuntimeNodeView),
          seedSources: seedSourcesOfNode(targetNodeId, runtimeHost),
          expectedBindingRevision: runtime.bindingRevisionOf(targetNodeId),
        },
      },
      options,
    );
  };
  const startImageEnhanceJob = async (submission: ImageEnhanceSubmission, silent = false): Promise<void> => {
    const { nodeId, payload: input, identity } = submission;
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const isDraftTarget = ((node?.data ?? {}) as Record<string, unknown>).draft === true;
    patchMediaNode(nodeId, {
      genStatus: 'generating',
      progress: 0,
      errorText: undefined,
      ...(isDraftTarget && !hasCustomName(node) ? { fileName: '高清生成中' } : {}),
      imageEnhance: { ...identity, lastParams: input },
    });
    const target = imageToolTargetOfNode(nodeId);
    if (!target) throw new Error('高清目标卡不存在');
    try {
      await dispatchImageToolTask({ kind: 'imageEnhance', input }, target);
    } catch (error) {
      if (!silent || !isSilentAuthError(error)) throw error;
    }
  };
  const startImageOutpaintJob = async (
    nodeId: string,
    input: ImageOutpaintInput,
    opts?: { projectId?: string; silent?: boolean },
  ): Promise<void> => {
    const projectId = opts?.projectId ?? currentId;
    if (!projectId) {
      showToast('warn', '未选中项目，无法发起扩图');
      return;
    }
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const identity = ((node?.data ?? {}) as Record<string, unknown>).imageOutpaint as ImageOutpaintIdentity | undefined;
    const isDraftTarget = ((node?.data ?? {}) as Record<string, unknown>).draft === true;
    patchMediaNode(nodeId, {
      genStatus: 'generating',
      progress: 0,
      errorText: undefined,
      ...(isDraftTarget && !hasCustomName(node) ? { fileName: '扩图生成中' } : {}),
      imageOutpaint: { ...identity, lastParams: input },
    });
    const target = imageToolTargetOfNode(nodeId);
    if (!target) throw new Error('扩图目标卡不存在');
    try {
      await dispatchImageToolTask({ kind: 'imageOutpaint', input }, target);
    } catch (error) {
      if (!opts?.silent || !isSilentAuthError(error)) throw error;
    }
  };
  const prepareOutpaintTask = (frozen: OutpaintFrozenInput): OutpaintTaskSubmission | null => {
    const { projectId, source: sourceNode, sourceAssetId, ratios } = frozen;
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(sourceNode), {
      fileName: '扩图',
      data: { imageOutpaint: { sourceAssetId } },
    });
    addCanvasEdge(sourceNode.id, draftId, undefined, { origin: IMAGE_OUTPAINT_EDGE_ORIGIN });
    const input = buildImageOutpaintInput(sourceAssetId, draftId, ratios);
    if (!input) {
      removeCanvasNodes([draftId]);
      showToast('warn', '扩图参数不合法，请调整后重试');
      return null;
    }
    return { projectId, source: sourceNode, targetNodeId: draftId, payload: input };
  };
  const outpaint: CanvasToolHosts['outpaint'] = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    clearPickState,
    prepareTask: prepareOutpaintTask,
    startTask: ({ projectId, targetNodeId, payload }) => startImageOutpaintJob(targetNodeId, payload, { projectId, silent: true }),
    warn: (message) => showToast('warn', message),
    error: (message) => globalToast.error(message),
  };
  const handoffImageEraseTask = async (
    submission: ImageEraseTaskSubmission,
    created: { job_id: string },
    skipSelect: boolean,
  ): Promise<void> => {
    const { source: node, payload: input } = submission;
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(node), {
      fileName: '擦除',
      nodeId: input.target_node_id,
      skipSelect,
      data: {
        imageErase: { sourceAssetId: input.source_asset_id, lastInput: input },
        genStatus: 'generating',
        progress: 0,
        jobId: created.job_id,
      },
    });
    addCanvasEdge(node.id, draftId, undefined, { origin: IMAGE_ERASE_EDGE_ORIGIN });
  };
  const erase: CanvasToolHosts['erase'] = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    newTargetId: () => newNodeId('media-draft'),
    encodeMask: rasterizeMaskToPngFile,
    uploadMask: (file, projectId) => uploadAssetFile(file, { projectId, assetSource: 'mask_erase', silent: true }),
    createTask: ({ source, payload }) => {
      const target = imageToolTargetBesideSource(source, '擦除', payload.target_node_id);
      return dispatchImageToolTask({ kind: 'imageErase', input: payload }, target).then((job_id) => ({ job_id }));
    },
    handoff: handoffImageEraseTask,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };
  const subtitleErase: CanvasToolHosts['subtitleErase'] = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    newTargetId: () => newNodeId('media-draft'),
    startTask: (input: SubtitleEraseTaskSubmission, skipSelect: boolean): boolean => {
      const { source: node, payload } = input;
      const targetNodeId = payload.target_node_id;
      const sourceData = node.data;
      createImageDraftCard(imageEnhanceDraftPosition(node), {
        fileName: '去字幕',
        nodeId: targetNodeId,
        skipSelect,
        data: {
          mediaType: 'video',
          ...(typeof sourceData.width === 'number' ? { width: sourceData.width } : {}),
          ...(typeof sourceData.height === 'number' ? { height: sourceData.height } : {}),
          videoSubtitleErase: { sourceAssetId: payload.source_asset_id, lastInput: payload },
          genStatus: 'generating',
          progress: 0,
        },
      });
      addCanvasEdge(node.id, targetNodeId, undefined, { origin: VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN });
      return submitVideoToolTask({ kind: 'subtitleErase', input: payload }, targetNodeId);
    },
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };
  const handoffCutoutTask = async (
    submission: CutoutSubmission,
    created: { job_id: string },
    skipSelect: boolean,
  ): Promise<void> => {
    const { source: node, payload: input } = submission;
    const draftId = createImageDraftCard(imageEnhanceDraftPosition(node), {
      fileName: '抠图',
      nodeId: input.target_node_id,
      skipSelect,
      data: {
        imageCutout: { sourceAssetId: input.source_asset_id, lastInput: input },
        genStatus: 'generating',
        progress: 0,
        jobId: created.job_id,
      },
    });
    addCanvasEdge(node.id, draftId, undefined, { origin: IMAGE_CUTOUT_EDGE_ORIGIN });
  };
  const cutout: CanvasToolHosts['cutout'] = {
    getProjectId: () => currentId,
    getSourceNode: (nodeId) => mediaNodesRef.current.find((node) => node.id === nodeId),
    newTargetId: () => newNodeId('media-draft'),
    createTask: ({ source, payload }) => {
      const target = imageToolTargetBesideSource(source, '抠图', payload.target_node_id);
      return dispatchImageToolTask({ kind: 'imageCutout', input: payload }, target).then((job_id) => ({ job_id }));
    },
    handoff: handoffCutoutTask,
    warn: (message) => showToast('warn', message),
    error: (message) => showToast('error', message),
  };
  const handleCancelJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (node && generationRuntimeRef.current?.claims(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      generationRuntimeRef.current.cancel(nodeId);
      return;
    }
  };
  toolHostsRef.current.outpaint = outpaint;
  toolHostsRef.current.erase = erase;
  toolHostsRef.current.subtitleErase = subtitleErase;
  toolHostsRef.current.cutout = cutout;

  return { imageToolTargetOfNode, dispatchImageToolTask, startImageEnhanceJob, submitVideoToolTask, handleCancelJob, outpaint, erase, subtitleErase, cutout };
}
