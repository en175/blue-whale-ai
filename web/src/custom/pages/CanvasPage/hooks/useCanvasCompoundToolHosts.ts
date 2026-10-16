import { type VideoRefRole } from '@/custom/enums';
import { useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { toast as globalToast } from '@/custom/components/Toast';
import { isApiError } from '@/shared/api/http';
import { newIdempotencyKey } from '@/shared/api/idempotencyKey';
import { uploadAssetFile } from '@/custom/utils/upload';
import { newNodeId } from '../nodeId';
import { hasGenerationRecord } from '../mediaReEdit';
import { readAssetId } from '../mediaRefs';
import { mediaCardToolbarVisible } from '../components/MediaNode/toolbarVisibility';
import {
  MEDIA_EXTRACT_EDGE_ORIGIN,
  MEDIA_EXTRACT_NODE_PREFIX,
  buildMediaExtractPlaceholderNode,
  mediaExtractNodeId,
} from '../mediaExtract';
import type { CanvasToolHosts } from '../canvasToolSessions';
import { type AudioVideoSplitSubmission } from '../tools/audio/audioVideoSplitSession';
import {
  AUDIO_TRIM_EDGE_ORIGIN,
  AUDIO_TRIM_NODE_PREFIX,
  audioTrimNodeId,
  buildAudioTrimPlaceholderNode,
} from '../tools/audio/audioTrim';
import { type VocalSplitPayload, type AudioToolSubmission } from '../tools/audio/audioToolSessions';
import type { AudioTrimInput } from '@lib/contracts/audio-trim';
import { AUDIO_MIX_EDGE_ORIGIN, buildAudioMixPlaceholderNode, findAudioMixPosition } from '../tools/audio/audioMix';
import {
  AUDIO_SPEED_EDGE_ORIGIN,
  AUDIO_SPEED_NODE_PREFIX,
  audioSpeedNodeId,
  buildAudioSpeedPlaceholderNode,
} from '../tools/audio/audioSpeed';
import type { AudioSpeedInput } from '@lib/contracts/audio-speed';
import {
  AUDIO_VIDEO_MUX_EDGE_ORIGIN,
  AUDIO_VIDEO_MUX_TITLE,
  buildAudioVideoMuxIdentity,
  isAudioVideoMuxBindEdge,
} from '../tools/audio/audioVideoMux';
import { VOCAL_SPLIT_EDGE_ORIGIN, buildVocalSplitPlaceholderNode } from '../tools/audio/vocalSplit';
import { SCENE_SPLIT_EDGE_ORIGIN, buildSceneSplitPlaceholderNode } from '../tools/video/sceneSplit';
import { type SceneSplitSubmission } from '../tools/video/sceneSplitSession';
import { SMART_MATTING_EDGE_ORIGIN, buildSmartMattingPlaceholderNode } from '../tools/image/smartMatting';
import { imageEnhanceDraftPosition } from '../tools/image/imageEnhance';
import { type SmartMattingSubmission } from '../tools/image/smartMattingSession';
import { IMAGE_CROP_EDGE_ORIGIN, type ImageCropIdentity } from '../tools/image/imageCrop';
import { type ToolSessionDeps } from '../toolSessionCoordinator';
import type { GenerationRuntime, GenerationRuntimeHost } from '../generationRuntime/runtime';
import { audioMixTask, audioVideoMuxTask, staleMixSubmitError, watchMixSubmit } from '../generationRuntime/mixMuxTasks';
import { sceneSplitTask, vocalSplitTask } from '../generationRuntime/multiOutputTasks';
import { seedTargetOfNode, seedSourcesOfNode } from '../generationRuntime/seedFacts';
import type { RuntimeNodeView } from '../generationRuntime/types';

import type { CanvasDraftCardCreatorsHandles } from './useCanvasDraftCardCreators';
import type { CanvasImageToolHostsHandles } from './useCanvasImageToolHosts';
import type { CanvasToolJobSubmissionsHandles } from './useCanvasToolJobSubmissions';

export interface CanvasCompoundToolHostsInput {
  toolHostsRef: RefObject<Partial<CanvasToolHosts>>;
  toolDepsRef: RefObject<ToolSessionDeps | null>;
  currentId: string;
  canOpenEditor: (nodeId?: string) => boolean;
  mediaNodesRef: RefObject<Node[]>;
  textNodesRef: RefObject<Node[]>;
  productNodesRef: RefObject<Node[]>;
  assetNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  activeProjectRef: RefObject<string | null>;
  docLoadEpochRef: RefObject<object>;
  generationRuntimeRef: RefObject<GenerationRuntime | null>;
  generationRuntimeHostRef: RefObject<GenerationRuntimeHost | null>;
  editingTargetRef: RefObject<string | null>;
  audioVideoMuxInFlightRef: RefObject<boolean>;
  audioMixInFlightRef: RefObject<boolean>;
  audioMixSubmitCardRef: RefObject<{ projectId: string; payload: string; nodeId: string; accepted: boolean } | null>;
  sceneSplitSendingRef: RefObject<boolean>;
  smartMattingSendingRef: RefObject<boolean>;
  attachCallbacks: (node: Node) => Node;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  removeTargetInputs: (ids: string[]) => void;
  createVideoDraftCard: CanvasDraftCardCreatorsHandles['createVideoDraftCard'];
  createImageDraftCard: CanvasDraftCardCreatorsHandles['createImageDraftCard'];
  submitVideoToolTask: CanvasImageToolHostsHandles['submitVideoToolTask'];
  startImageEnhanceJob: CanvasImageToolHostsHandles['startImageEnhanceJob'];
  startVideoEnhanceJob: CanvasToolJobSubmissionsHandles['handleStartVideoEnhance'];
  startFrameInterpolationJob: CanvasToolJobSubmissionsHandles['handleStartFrameInterpolation'];
  isVideoEnhanceCardInFlight: (nodeId: string) => boolean;
  setSoloSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  setSelectRequest: Dispatch<SetStateAction<{ id: string; ts: number } | null>>;
  flushCanvasSave: (projectId: string) => Promise<boolean>;
  linkAudioMixAssets: (input: { projectId: string; assetIds: string[] }) => Promise<unknown>;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  dismissGenPanels: () => void;
}

export function useCanvasCompoundToolHosts(input: CanvasCompoundToolHostsInput): void {
  const inputRef = useRef(input);
  inputRef.current = input;
  const hosts = useMemo(() => createCompoundToolHosts(inputRef), []);
  const { toolHostsRef, toolDepsRef } = input;
  if (toolHostsRef.current.panels !== hosts.panels) {
    Object.assign(toolHostsRef.current, hosts);
  }
  toolDepsRef.current = {
    dismissGenPanels: () => inputRef.current.dismissGenPanels(),
    selectNode: (nodeId) => inputRef.current.setSelectRequest({ id: nodeId, ts: Date.now() }),
  };
}

function createCompoundToolHosts(inputRef: RefObject<CanvasCompoundToolHostsInput>): Pick<
  CanvasToolHosts,
  'panels' | 'audioVideoMux' | 'crop' | 'audioVideoSplit' | 'audioTrim' | 'audioSpeed' | 'vocalSplit' | 'sceneSplit' | 'audioMix' | 'smartMatting'
> {
  const get = () => inputRef.current;
  const findMedia = (id: string) => get().mediaNodesRef.current.find((node) => node.id === id);
  const warnError = {
    warn: (message: string) => get().showToast('warn', message),
    error: (message: string) => get().showToast('error', message),
  };
  const pushPlaceholder = (placeholder: Node) => {
    const { mediaNodesRef, setMediaNodes } = get();
    const current = mediaNodesRef.current;
    const next = current.some((item) => item.id === placeholder.id) ? current : [...current, placeholder];
    mediaNodesRef.current = next;
    setMediaNodes(next);
    return next;
  };

  const panels: CanvasToolHosts['panels'] = {
    getProjectId: () => get().activeProjectRef.current,
    getNode: (nodeId) => findMedia(nodeId),
    getNodes: () => get().mediaNodesRef.current,
    canOpen: (nodeId) => get().canOpenEditor(nodeId),
    activate(nodeId, toolbar) {
      const ctx = get();
      ctx.editingTargetRef.current = nodeId;
      const node = findMedia(nodeId);
      if (toolbar && mediaCardToolbarVisible((node?.data ?? {}) as Record<string, unknown>)) {
        ctx.setSoloSelectedNodeId(nodeId);
        ctx.setSelectRequest({ id: nodeId, ts: Date.now() });
      }
    },
    isValidTarget(nodeId, kind) {
      const node = findMedia(nodeId);
      return Boolean(node && (node.data.draft === true || hasGenerationRecord(node)) && node.data[kind]);
    },
    isFrameInFlight: (nodeId) => get().generationRuntimeRef.current?.statusOf(nodeId)?.phase === 'submitting',
    isVideoEnhanceInFlight: (nodeId) => get().isVideoEnhanceCardInFlight(nodeId),
    startImage: (input) => get().startImageEnhanceJob(input, true),
    startVideo: (input) => get().startVideoEnhanceJob(input),
    startFrame: (input) => get().startFrameInterpolationJob(input),
    warn: warnError.warn,
    error: warnError.error,
    httpError: (message) => globalToast.error(message),
  };

  const audioVideoMux: CanvasToolHosts['audioVideoMux'] = {
    getProjectId: () => get().currentId,
    getNode: (id) => findMedia(id),
    createDraft: (source) => {
      const ctx = get();
      const draftId = ctx.createVideoDraftCard(undefined, findAudioMixPosition(source, ctx.mediaNodesRef.current), {
        fileName: AUDIO_VIDEO_MUX_TITLE,
        data: { audioVideoMux: buildAudioVideoMuxIdentity(source.id, readAssetId(source.data)) },
      });
      ctx.addCanvasEdge(source.id, draftId, undefined, { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN });
      return draftId;
    },
    patchIdentity: (draftId, identity) => get().patchMediaNode(draftId, { audioVideoMux: identity }),
    removeBindEdges: (draft) => {
      const ctx = get();
      const stale = ctx.edgesRef.current.filter((edge) => isAudioVideoMuxBindEdge(edge, draft));
      if (stale.length > 0) ctx.removeTargetInputs(stale.map((edge) => edge.id));
    },
    addVideoEdge: (sourceId, draftId) => get().addCanvasEdge(sourceId, draftId, undefined, { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN }),
    isInFlight: () => get().audioVideoMuxInFlightRef.current,
    setInFlight: (value) => { get().audioVideoMuxInFlightRef.current = value; },
    canApply: (projectId) => get().activeProjectRef.current === projectId,
    createTask: async ({ payload, draftId }) => {
      const ctx = get();
      const runtime = ctx.generationRuntimeRef.current;
      if (!runtime) throw new Error('生成任务运行时未就绪，请刷新后重试');
      const draft = findMedia(draftId);
      if (!draft) throw new Error('合成草稿卡不在画布上，无法发送');
      const seedTarget = seedTargetOfNode(draft as unknown as RuntimeNodeView);
      return await new Promise<{ job_id: string }>((resolve, reject) => {
        const unwatch = watchMixSubmit(draftId, {
          accepted: (jobId) => { unwatch(); resolve({ job_id: jobId }); },
          failed: (error) => { unwatch(); reject(error); },
        });
        const issued = runtime.submit(
          audioVideoMuxTask,
          {
            payload,
            target: {
              targetNodeId: draftId,
              seedTarget,
              seedSources: seedSourcesOfNode(draftId, ctx.generationRuntimeHostRef.current!),
              expectedBindingRevision: runtime.bindingRevisionOf(draftId),
            },
          },
          {
            onCreateFailure: () => {
              ctx.patchMediaNode(draftId, {
                genStatus: 'draft', progress: undefined, errorText: undefined,
                jobId: undefined, generationRecovery: undefined,
              });
              return true;
            },
            onStale: () => { unwatch(); reject(staleMixSubmitError()); },
          },
        );
        if (!issued) {
          unwatch();
          reject(new Error('音视频合成任务未受理，请重试'));
        }
      });
    },
    handoff: async ({ projectId, draftId }) => {
      const ctx = get();
      if (ctx.mediaNodesRef.current.some((node) => node.id === draftId)) {
        ctx.patchMediaNode(draftId, { genStatus: 'generating', progress: 0, errorText: undefined });
      }
      void ctx.flushCanvasSave(projectId).catch(() => {});
    },
    ...warnError,
  };

  const crop: CanvasToolHosts['crop'] = {
    getProjectId: () => get().currentId,
    getSourceNode: (nodeId) => findMedia(nodeId),
    uploadFile: (file, projectId) => uploadAssetFile(file, { projectId, silent: true }),
    handoff: ({ source }, uploaded) => {
      const ctx = get();
      const draftId = ctx.createImageDraftCard(imageEnhanceDraftPosition(source), {
        fileName: '裁切',
        skipSelect: true,
        data: {
          src: uploaded.url,
          assetId: uploaded.asset_id,
          width: uploaded.width,
          height: uploaded.height,
          mime: uploaded.mime,
          size: uploaded.size,
          genStatus: undefined,
          draft: undefined,
          imageCrop: { sourceAssetId: String(uploaded.asset_id) } satisfies ImageCropIdentity,
        },
      });
      ctx.addCanvasEdge(source.id, draftId, undefined, { origin: IMAGE_CROP_EDGE_ORIGIN });
    },
    ...warnError,
  };

  const audioVideoSplit: CanvasToolHosts['audioVideoSplit'] = {
    getProjectId: () => get().currentId,
    getSourceNode: (nodeId) => findMedia(nodeId),
    startTask: (input: AudioVideoSplitSubmission): boolean => {
      const ctx = get();
      const { source: node, payload } = input;
      const targetNodeId = mediaExtractNodeId(newIdempotencyKey());
      const placeholder = ctx.attachCallbacks(
        buildMediaExtractPlaceholderNode({
          jobId: targetNodeId.slice(MEDIA_EXTRACT_NODE_PREFIX.length),
          outputFormat: payload.output_format,
          sourceAssetId: payload.source_asset_id,
          source: node,
        }) as Node,
      );
      pushPlaceholder(placeholder);
      ctx.addCanvasEdge(node.id, targetNodeId, undefined, { origin: MEDIA_EXTRACT_EDGE_ORIGIN });
      return ctx.submitVideoToolTask({ kind: 'mediaExtract', input: payload }, targetNodeId);
    },
    ...warnError,
  };

  const audioTrim: CanvasToolHosts['audioTrim'] = {
    getProjectId: () => get().currentId,
    getSourceNode: (nodeId) => findMedia(nodeId),
    startTask: (input: AudioToolSubmission<AudioTrimInput>): boolean => {
      const ctx = get();
      const { source: node, payload } = input;
      const targetNodeId = audioTrimNodeId(newIdempotencyKey());
      const placeholder = ctx.attachCallbacks(
        buildAudioTrimPlaceholderNode({
          jobId: targetNodeId.slice(AUDIO_TRIM_NODE_PREFIX.length),
          outputFormat: payload.output_format,
          timeParams: { start_time: payload.start_time, end_time: payload.end_time },
          sourceAssetId: payload.source_asset_id,
          source: node,
        }) as Node,
      );
      pushPlaceholder(placeholder);
      ctx.addCanvasEdge(node.id, targetNodeId, undefined, { origin: AUDIO_TRIM_EDGE_ORIGIN });
      return ctx.submitVideoToolTask({ kind: 'audioTrim', input: payload }, targetNodeId);
    },
    ...warnError,
  };

  const audioSpeed: CanvasToolHosts['audioSpeed'] = {
    getProjectId: () => get().currentId,
    getSourceNode: (nodeId) => findMedia(nodeId),
    startTask: (input: AudioToolSubmission<AudioSpeedInput>): boolean => {
      const ctx = get();
      const { source: node, payload } = input;
      const targetNodeId = audioSpeedNodeId(newIdempotencyKey());
      const placeholder = ctx.attachCallbacks(
        buildAudioSpeedPlaceholderNode({
          jobId: targetNodeId.slice(AUDIO_SPEED_NODE_PREFIX.length),
          speed: payload.speed ?? 1,
          sourceAssetId: payload.source_asset_id,
          source: node,
        }) as Node,
      );
      pushPlaceholder(placeholder);
      ctx.addCanvasEdge(node.id, targetNodeId, undefined, { origin: AUDIO_SPEED_EDGE_ORIGIN });
      return ctx.submitVideoToolTask({ kind: 'audioSpeed', input: payload }, targetNodeId);
    },
    ...warnError,
  };

  const vocalSplit: CanvasToolHosts['vocalSplit'] = {
    getProjectId: () => get().currentId,
    getSourceNode: (nodeId) => findMedia(nodeId),
    runTask: async (input: AudioToolSubmission<VocalSplitPayload>): Promise<void> => {
      const ctx = get();
      const { source: node, payload } = input;
      const sourceNodeId = node.id;
      const placeholderId = newNodeId('vocal-split');
      const placeholder = ctx.attachCallbacks(
        buildVocalSplitPlaceholderNode({
          nodeId: placeholderId,
          scene: payload.scene,
          outputFormat: payload.output_format,
          sourceAssetId: payload.source_asset_id,
          source: node,
        }) as Node,
      );
      pushPlaceholder(placeholder);
      ctx.addCanvasEdge(sourceNodeId, placeholderId, undefined, { origin: VOCAL_SPLIT_EDGE_ORIGIN });
      const runtime = ctx.generationRuntimeRef.current;
      const placeholderView = findMedia(placeholderId);
      if (!runtime || !placeholderView) throw new Error('生成任务运行时未就绪');
      const dispatched = runtime.submit(
        vocalSplitTask,
        {
          payload: { source_asset_id: payload.source_asset_id, scene: payload.scene, output_format: payload.output_format },
          target: {
            targetNodeId: placeholderId,
            seedTarget: seedTargetOfNode(placeholderView as unknown as RuntimeNodeView),
            seedSources: seedSourcesOfNode(placeholderId, ctx.generationRuntimeHostRef.current!),
            expectedBindingRevision: runtime.bindingRevisionOf(placeholderId),
          },
        },
        {
          onCreateFailure: (e: unknown) => {
            ctx.patchMediaNode(placeholderId, {
              genStatus: 'failed',
              errorText: isApiError(e) ? e.message : '人声背景分离任务创建失败，请重试',
            });
            return true;
          },
        },
      );
      if (!dispatched) throw new Error('人声背景分离任务提交被拒绝（无项目或在途防重入），请重试');
    },
    ...warnError,
  };

  const sceneSplit: CanvasToolHosts['sceneSplit'] = {
    getProjectId: () => get().currentId,
    getSourceNode: (nodeId) => findMedia(nodeId),
    newTargetId: () => newNodeId('scene-split'),
    isSending: () => get().sceneSplitSendingRef.current,
    runTask: async (input: SceneSplitSubmission): Promise<void> => {
      const ctx = get();
      const { source: node, payload } = input;
      const sourceNodeId = node.id;
      ctx.sceneSplitSendingRef.current = true;
      const placeholderId = payload.target_node_id;
      const placeholder = ctx.attachCallbacks(
        buildSceneSplitPlaceholderNode({
          nodeId: placeholderId,
          granularity: payload.granularity,
          sourceAssetId: payload.source_asset_id,
          source: node,
        }) as Node,
      );
      pushPlaceholder(placeholder);
      ctx.addCanvasEdge(sourceNodeId, placeholderId, undefined, { origin: SCENE_SPLIT_EDGE_ORIGIN });
      try {
        const runtime = ctx.generationRuntimeRef.current;
        const placeholderView = findMedia(placeholderId);
        if (!runtime || !placeholderView) throw new Error('生成任务运行时未就绪');
        const dispatched = runtime.submit(
          sceneSplitTask,
          {
            payload: { source_asset_id: payload.source_asset_id, target_node_id: placeholderId, granularity: payload.granularity },
            target: {
              targetNodeId: placeholderId,
              seedTarget: seedTargetOfNode(placeholderView as unknown as RuntimeNodeView),
              seedSources: seedSourcesOfNode(placeholderId, ctx.generationRuntimeHostRef.current!),
              expectedBindingRevision: runtime.bindingRevisionOf(placeholderId),
            },
          },
          {
            onCreateFailure: (e: unknown) => {
              ctx.patchMediaNode(placeholderId, {
                genStatus: 'failed',
                errorText: isApiError(e) ? e.message : '场景切分任务创建失败，请重试',
              });
              return true;
            },
          },
        );
        if (!dispatched) throw new Error('场景切分任务提交被拒绝（无项目或在途防重入），请重试');
      } finally {
        ctx.sceneSplitSendingRef.current = false;
      }
    },
    ...warnError,
  };

  const audioMix: CanvasToolHosts['audioMix'] = {
    getProjectId: () => get().currentId,
    getNode: (id) => findMedia(id),
    isInFlight: () => get().audioMixInFlightRef.current,
    setInFlight: (value) => { get().audioMixInFlightRef.current = value; },
    canApply: (projectId) => get().activeProjectRef.current === projectId,
    linkAssets: async (linkInput) => {
      await get().linkAudioMixAssets({ projectId: linkInput.projectId, assetIds: linkInput.libraryAssetIds });
    },
    createTask: async ({ projectId, payload, source }) => {
      const ctx = get();
      const runtime = ctx.generationRuntimeRef.current;
      if (!runtime) throw new Error('生成任务运行时未就绪，请刷新后重试');
      const submitEpoch = ctx.docLoadEpochRef.current;
      const payloadText = JSON.stringify(payload);
      const previousCard = ctx.audioMixSubmitCardRef.current;
      const nodeId = previousCard && previousCard.projectId === projectId
        && previousCard.payload === payloadText && !previousCard.accepted
        ? previousCard.nodeId
        : newNodeId('audio-mix');
      ctx.audioMixSubmitCardRef.current = { projectId, payload: payloadText, nodeId, accepted: false };
      const occupied = [
        ...ctx.mediaNodesRef.current,
        ...ctx.textNodesRef.current,
        ...ctx.productNodesRef.current,
        ...ctx.assetNodesRef.current,
      ];
      const position = findAudioMixPosition(source, occupied);
      const placeholder = ctx.attachCallbacks(buildAudioMixPlaceholderNode(nodeId, payload.output_format, position));
      const current = ctx.mediaNodesRef.current;
      ctx.mediaNodesRef.current = current.some((node) => node.id === nodeId) ? current : [...current, placeholder];
      ctx.setMediaNodes(ctx.mediaNodesRef.current);
      const liveNodeIds = new Set(current.map((node) => node.id));
      for (const mixInput of payload.inputs) {
        if (mixInput.node_id && liveNodeIds.has(mixInput.node_id)) {
          ctx.addCanvasEdge(mixInput.node_id, nodeId, undefined, { origin: AUDIO_MIX_EDGE_ORIGIN });
        }
      }
      const rollbackPlaceholder = () => {
        if (ctx.activeProjectRef.current !== projectId) return;
        if (ctx.docLoadEpochRef.current !== submitEpoch) return;
        const currentNode = findMedia(nodeId);
        if (!currentNode || currentNode.data?.jobId != null) return;
        if (ctx.generationRuntimeRef.current?.statusOf(nodeId) != null) return;
        const keepEdge = (edge: Edge) => !(edge.target === nodeId && edge.data?.origin === AUDIO_MIX_EDGE_ORIGIN);
        ctx.mediaNodesRef.current = ctx.mediaNodesRef.current.filter((node) => node.id !== nodeId);
        ctx.edgesRef.current = ctx.edgesRef.current.filter(keepEdge);
        ctx.setMediaNodes((prev) => prev.filter((node) => node.id !== nodeId));
        ctx.setEdges((prev) => prev.filter(keepEdge));
      };
      return await new Promise<{ job_id: string }>((resolve, reject) => {
        const unwatch = watchMixSubmit(nodeId, {
          accepted: (jobId) => {
            const entry = ctx.audioMixSubmitCardRef.current;
            if (entry?.nodeId === nodeId) ctx.audioMixSubmitCardRef.current = { ...entry, accepted: true };
            unwatch();
            resolve({ job_id: jobId });
          },
          failed: (error) => { unwatch(); reject(error); },
        });
        const issued = runtime.submit(
          audioMixTask,
          {
            payload,
            target: {
              targetNodeId: nodeId,
              seedTarget: {
                role: 'result-placeholder',
                x: position.x,
                y: position.y,
                width: 480,
                height: 284,
                name: `混合结果.${payload.output_format}`,
              },
              seedSources: seedSourcesOfNode(nodeId, ctx.generationRuntimeHostRef.current!),
              expectedBindingRevision: runtime.bindingRevisionOf(nodeId),
            },
          },
          {
            onCreateFailure: () => { rollbackPlaceholder(); return true; },
            onStale: () => { unwatch(); rollbackPlaceholder(); reject(staleMixSubmitError()); },
          },
        );
        if (!issued) {
          unwatch();
          rollbackPlaceholder();
          reject(new Error('音频混合任务未受理，请重试'));
        }
      });
    },
    handoff: async (_input, _task, context) => {
      context.exitForSubmission();
    },
    ...warnError,
  };

  const smartMatting: CanvasToolHosts['smartMatting'] = {
    getProjectId: () => get().currentId,
    getSourceNode: (nodeId) => findMedia(nodeId),
    newTargetId: () => newNodeId('smart-matting'),
    isSending: () => get().smartMattingSendingRef.current,
    runTask: async (input: SmartMattingSubmission): Promise<void> => {
      const ctx = get();
      ctx.smartMattingSendingRef.current = true;
      const { source: node, payload: lastInput } = input;
      const sourceNodeId = node.id;
      const placeholderId = lastInput.target_node_id;
      try {
        const placeholder = ctx.attachCallbacks(
          buildSmartMattingPlaceholderNode({
            nodeId: placeholderId,
            mode: lastInput.mode,
            sourceAssetId: lastInput.source_asset_id,
            lastInput,
            source: node,
          }) as Node,
        );
        pushPlaceholder(placeholder);
        ctx.addCanvasEdge(sourceNodeId, placeholderId, undefined, { origin: SMART_MATTING_EDGE_ORIGIN });
        if (!ctx.submitVideoToolTask({ kind: 'smartMatting', input: lastInput }, placeholderId)) {
          ctx.patchMediaNode(placeholderId, { genStatus: 'failed', errorText: '智能抠像任务未发出，请重试' });
        }
      } finally {
        ctx.smartMattingSendingRef.current = false;
      }
    },
    warn: (message) => get().showToast('warn', message),
    error: (message) => globalToast.error(message),
  };

  return {
    panels,
    audioVideoMux,
    crop,
    audioVideoSplit,
    audioTrim,
    audioSpeed,
    vocalSplit,
    sceneSplit,
    audioMix,
    smartMatting,
  };
}
