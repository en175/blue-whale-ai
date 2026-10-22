import { type MediaGenStatus, type VideoRefRole } from '@/custom/enums';
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { envelopeErrorCode, isApiError } from '@/shared/api/http';
import {
  quoteSampleRegenerate,
  quoteVideoFinalize,
  type AudioJobParameters,
  type CreateJobPayload,
  type GenerationRefItem,
  type ImageJobParameters,
  type VideoJobParameters,
} from '@/custom/api/jobs';
import { flattenPromptDocForSend, type PromptDoc } from '@/custom/utils/prompt-doc';
import { normalizeVideoMode, type VideoMode } from '@/custom/utils/video-modes';
import { blockIfCreditsInsufficient, openRechargeForCreditsError } from '@/custom/utils/creditsGate';
import { composeImageSendPrompt } from '../../components/ImageDialog/composeImageSendPrompt';
import type { ImageTextAttachment } from '../../components/ImageDialog';
import type { MediaNodeData } from '../../components/MediaNode';
import { mediaContentBox, type MediaDims } from '../../components/MediaNode/mediaContentSize';
import { sampleDeadlineExpired } from '../../components/MediaNode/mediaPlayback';
import type { createCanvasToolSessions } from '../../tool-runtime/canvasToolSessions';
import { draftFileNameOf, hasCustomName } from '../../graph/canvasNodeUtils';
import { normalGenerationTask } from '../../generation/normalGeneration';
import { storyboardTask, type StoryboardPayload } from '../../generation/storyboardTasks';
import type { RecoverySeedSource, RecoverySeedTarget } from '../../generation/types';
import { readAssetId } from '../../media/mediaRefs';
import { isInPlaceRegenTarget } from '../../media/mediaReEdit';
import { newNodeId } from '../../graph/nodeId';
import { mergedVideoMediaRefsOf, videoRefSourceError } from '../../tools/video/videoMediaRefs';
import { draftVideoModeOf } from '../../tools/video/videoModes';
import type { CanvasGenerationTerminalHost } from './useCanvasGenerationTerminal';

type ToolMode = 'drag' | 'select';

type ActionsRef = RefObject<{
  removeMediaNode: (id: string) => void;
  cancelJob: (id: string) => void;
  retryJob: (id: string) => void;
  fixFollowVideo: (id: string) => void;
  duplicate: (id: string) => void;
  renameCard: (id: string, name: string) => void;
  addToChat: (id: string) => void;
  download: (id: string) => void;
  showDetails: (id: string) => void;
}>;

export type FinalizeCtaState = NonNullable<MediaNodeData['finalizeCta']>;

export type RegenerateCtaState = NonNullable<MediaNodeData['regenerateCta']>;

export interface CanvasGenerationSubmissionHost extends CanvasGenerationTerminalHost {
  mediaNodes: Node[];
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  actionsRef: ActionsRef;
  toolMode: ToolMode;
  blockInvalidDraft: (ids: string[]) => boolean;
  spawnPosition: () => { x: number; y: number };
  textAttachmentsForSend: (targetNodeId: string) => ImageTextAttachment[];
  handleMediaDims: (nodeId: string, dims: MediaDims) => void;
  handleSaveMediaToAssets: (nodeId: string) => void;
  dockCallbacks: ReturnType<typeof createCanvasToolSessions>['callbacks'] & {
    onEnhanceImage: (id: string) => void;
    onVideoEnhance: (id: string) => void;
    onFrameInterpolation: (id: string) => void;
  };
}

export interface CanvasGenerationSubmissionHandles {
  startGenerationJob: (
    type: 'image' | 'video' | 'audio',
    parameters: ImageJobParameters | VideoJobParameters | AudioJobParameters,
    inputAssetIds?: string[],
    videoRefs?: {
      references?: GenerationRefItem[];
      firstFrameAssetId?: string;
      lastFrameAssetId?: string;
      referenceAssetIds?: string[];
      firstFrameMaterialId?: string;
      lastFrameMaterialId?: string;
      referenceMaterials?: Array<{ id: string; type: 'image' | 'video' }>;
    },
    targetNodeId?: string,
    initialDraft?: {
      mode?: string;
      references: Array<{
        assetId: string;
        url: string;
        name: string;
        mediaType: 'image' | 'video';
        role: VideoRefRole;
        materialId?: string;
      }>;
      expectedCredits?: number;
      quoteRevision?: string;
    },
    promptDoc?: PromptDoc | null,
  ) => boolean;
  handleFinalizeSample: (sampleNodeId: string) => boolean;
  handleRegenerateSample: (entryNodeId: string) => boolean;
  regenEntrySampleJobIdOf: (d: Record<string, unknown>) => string | null;
  finalizeCtaByNodeId: Map<string, FinalizeCtaState>;
  regenerateCtaByNodeId: Map<string, RegenerateCtaState>;
}

function draftModeOfNodeIn(
  nodeId: string,
  mediaNodesRef: RefObject<Node[]>,
  edgesRef: RefObject<Edge[]>,
  data?: Record<string, unknown> | undefined,
): VideoMode | null {
  const source = data ?? (mediaNodesRef.current.find((n) => n.id === nodeId)?.data as Record<string, unknown> | undefined);
  return draftVideoModeOf(source, mergedVideoMediaRefsOf(nodeId, edgesRef.current, mediaNodesRef.current));
}

export function useCanvasGenerationSubmission(host: CanvasGenerationSubmissionHost): CanvasGenerationSubmissionHandles {
  const hostRef = useRef(host);
  hostRef.current = host;

  const [finalizeQuotes, setFinalizeQuotes] = useState<
    Record<string, { phase: 'loading' } | { phase: 'ready'; credits: number; revision: string } | { phase: 'empty' }>
  >({});
  const finalizeQuoteInflightRef = useRef(new Set<string>());
  const finalizeInflightRef = useRef(new Set<string>());
  const [finalizeUnknownSamples, setFinalizeUnknownSamples] = useState<ReadonlySet<string>>(() => new Set());
  const finalizeAttemptedJobIdsRef = useRef(new Set<string>());
  const [sampleRegenQuotes, setSampleRegenQuotes] = useState<
    Record<string, { phase: 'loading' } | { phase: 'ready'; credits: number; revision: string } | { phase: 'empty' }>
  >({});
  const sampleRegenQuoteInflightRef = useRef(new Set<string>());
  const sampleRegenInflightRef = useRef(new Set<string>());
  const [sampleRegenUnknownSamples, setSampleRegenUnknownSamples] = useState<ReadonlySet<string>>(() => new Set());
  const sampleRegenAttemptedJobIdsRef = useRef(new Set<string>());

  const submitStoryboardTask = (
    payload: StoryboardPayload,
    target: { targetNodeId: string; seedTarget: RecoverySeedTarget },
    ui: {
      removePlaceholder: () => void;
      markUnknown: () => void;
      refreshQuote: () => void;
      unknownToast: string;
      onFailure: () => void;
    },
  ): boolean => {
    const { generationRuntimeRef, showToast } = hostRef.current;
    const runtime = generationRuntimeRef.current;
    if (!runtime) return false;
    const dispatch = (retryUnknown: boolean): boolean => runtime.submit(
      storyboardTask,
      {
        payload,
        target: {
          targetNodeId: target.targetNodeId,
          seedTarget: target.seedTarget,
          seedSources: [],
          expectedBindingRevision: runtime.bindingRevisionOf(target.targetNodeId),
        },
      },
      {
        onCreateFailure: (e: unknown): boolean => {
          ui.onFailure();
          if (isApiError(e) && e.status !== 408 && e.status !== 0) {
            ui.removePlaceholder();
            if (Number(e.code) === 1014) {
              ui.markUnknown();
              showToast('warn', e.message);
              return true;
            }
            showToast('error', e.message);
            ui.refreshQuote();
            return true;
          }
          if (retryUnknown) {
            window.setTimeout(() => dispatch(false), 0);
            return true;
          }
          ui.removePlaceholder();
          ui.markUnknown();
          showToast('warn', ui.unknownToast);
          return true;
        },
      },
    );
    return dispatch(true);
  };

  const handleFinalizeSample = (sampleNodeId: string): boolean => {
    const {
      currentId, mediaNodesRef, setMediaNodes, showToast,
    } = hostRef.current;
    if (!currentId) {
      showToast('warn', '未选中项目，无法生成成片');
      return false;
    }
    const sample = mediaNodesRef.current.find((n) => n.id === sampleNodeId);
    const sampleData = (sample?.data ?? {}) as Record<string, unknown>;
    if (sample == null || sampleData.videoStage !== 'sample' || sampleData.jobId == null) return false;
    const sampleJobId = String(sampleData.jobId);
    if (finalizeUnknownSamples.has(sampleNodeId)) return false;
    if (finalizeInflightRef.current.has(sampleNodeId)) return false;
    if (mediaNodesRef.current.some(
      (n) =>
        ((n.data ?? {}) as Record<string, unknown>).videoStage === 'final'
        && String(((n.data ?? {}) as Record<string, unknown>).sourceSampleJobId ?? '') === sampleJobId,
    )) return false;
    const quote = finalizeQuotes[sampleNodeId];
    if (quote?.phase !== 'ready') return false;
    if (sampleData.finalizeDeadlineAt == null || sampleDeadlineExpired(sampleData.finalizeDeadlineAt as string)) {
      showToast('warn', '样片已过转成片期限或缺可信截止时间，无法生成成片');
      return false;
    }
    finalizeInflightRef.current.add(sampleNodeId);
    const box = mediaContentBox({
      mediaType: 'video',
      width: typeof sampleData.width === 'number' ? sampleData.width : undefined,
      height: typeof sampleData.height === 'number' ? sampleData.height : undefined,
      ratio: typeof sampleData.targetRatio === 'string' ? sampleData.targetRatio : undefined,
    });
    const finalNodeId = newNodeId('media-gen');
    const placeholder = hostRef.current.attachCallbacks({
      id: finalNodeId,
      type: 'mediaNode' as const,
      position: {
        x: Math.round(sample.position.x + box.width + 60),
        y: Math.round(sample.position.y),
      },
      data: {
        src: '',
        fileName: '成片生成中',
        mediaType: 'video' as const,
        genStatus: 'generating' as MediaGenStatus,
        progress: 0,
        videoStage: 'final' as const,
        sourceSampleJobId: sampleJobId,
        targetRatio: typeof sampleData.targetRatio === 'string' ? sampleData.targetRatio : undefined,
      },
    } as Node);
    const current = mediaNodesRef.current;
    mediaNodesRef.current = [...current, placeholder];
    setMediaNodes(mediaNodesRef.current);
    if (currentId) void hostRef.current.flushCanvasSave(currentId).catch(() => {});

    const clearSubmitting = () => {
      finalizeInflightRef.current.delete(sampleNodeId);
    };
    const removePlaceholder = () => {
      mediaNodesRef.current = mediaNodesRef.current.filter((n) => n.id !== finalNodeId);
      setMediaNodes(mediaNodesRef.current);
      if (currentId) void hostRef.current.flushCanvasSave(currentId).catch(() => {});
    };
    const markUnknown = () => {
      setFinalizeUnknownSamples((prev) => new Set(prev).add(sampleNodeId));
    };
    const refreshQuote = () => {
      setFinalizeQuotes((prev) => {
        if (!(sampleNodeId in prev)) return prev;
        const next = { ...prev };
        delete next[sampleNodeId];
        return next;
      });
    };
    const dispatched = submitStoryboardTask(
      {
        kind: 'finalize',
        sampleJobId,
        expectedCredits: quote.credits,
        quoteRevision: quote.revision,
        onAccepted: () => {
          finalizeAttemptedJobIdsRef.current.add(sampleJobId);
          clearSubmitting();
          window.setTimeout(() => {
            if (currentId) void hostRef.current.flushCanvasSave(currentId).catch(() => {});
          }, 0);
          showToast('success', `已提交成片生成，预计消耗 ${quote.credits} 积分`);
        },
      },
      {
        targetNodeId: finalNodeId,
        seedTarget: {
          role: 'result-placeholder',
          x: Math.round(sample.position.x + box.width + 60),
          y: Math.round(sample.position.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
          name: '成片生成中',
        },
      },
      {
        removePlaceholder,
        markUnknown,
        refreshQuote,
        unknownToast: '无法确认成片任务是否已提交，状态核对中，请勿重复提交',
        onFailure: clearSubmitting,
      },
    );
    if (!dispatched) {
      clearSubmitting();
      mediaNodesRef.current = mediaNodesRef.current.filter((n) => n.id !== finalNodeId);
      setMediaNodes(mediaNodesRef.current);
    }
    return dispatched;
  };

  const regenEntrySampleJobIdOf = (d: Record<string, unknown>): string | null => {
    if (d.videoStage === 'final' && d.genStatus === 'failed' && d.sourceSampleJobId != null) {
      return String(d.sourceSampleJobId);
    }
    return null;
  };

  const handleRegenerateSample = (entryNodeId: string): boolean => {
    const {
      currentId, mediaNodesRef, setMediaNodes, showToast,
    } = hostRef.current;
    if (!currentId) {
      showToast('warn', '未选中项目，无法重新生成样片');
      return false;
    }
    const origin = mediaNodesRef.current.find((n) => n.id === entryNodeId);
    const originData = (origin?.data ?? {}) as Record<string, unknown>;
    const sampleJobId = regenEntrySampleJobIdOf(originData);
    if (origin == null || sampleJobId == null) return false;
    if (sampleRegenUnknownSamples.has(sampleJobId)) return false;
    if (sampleRegenAttemptedJobIdsRef.current.has(sampleJobId)) return false;
    if (sampleRegenInflightRef.current.has(sampleJobId)) return false;
    const quote = sampleRegenQuotes[sampleJobId];
    if (quote?.phase !== 'ready') return false;
    sampleRegenInflightRef.current.add(sampleJobId);
    const box = mediaContentBox({
      mediaType: 'video',
      width: typeof originData.width === 'number' ? originData.width : undefined,
      height: typeof originData.height === 'number' ? originData.height : undefined,
      ratio: typeof originData.targetRatio === 'string' ? originData.targetRatio : undefined,
    });
    const regenNodeId = newNodeId('media-gen');
    const placeholder = hostRef.current.attachCallbacks({
      id: regenNodeId,
      type: 'mediaNode' as const,
      position: {
        x: Math.round(origin.position.x),
        y: Math.round(origin.position.y + box.height + 60),
      },
      data: {
        src: '',
        fileName: '样片生成中',
        mediaType: 'video' as const,
        genStatus: 'generating' as MediaGenStatus,
        progress: 0,
        videoStage: 'sample' as const,
        targetRatio: typeof originData.targetRatio === 'string' ? originData.targetRatio : undefined,
      },
    } as Node);
    mediaNodesRef.current = [...mediaNodesRef.current, placeholder];
    setMediaNodes(mediaNodesRef.current);
    if (currentId) void hostRef.current.flushCanvasSave(currentId).catch(() => {});

    const clearSubmitting = () => {
      sampleRegenInflightRef.current.delete(sampleJobId);
    };
    const removePlaceholder = () => {
      mediaNodesRef.current = mediaNodesRef.current.filter((n) => n.id !== regenNodeId);
      setMediaNodes(mediaNodesRef.current);
      if (currentId) void hostRef.current.flushCanvasSave(currentId).catch(() => {});
    };
    const markUnknown = () => {
      setSampleRegenUnknownSamples((prev) => new Set(prev).add(sampleJobId));
    };
    const refreshQuote = () => {
      setSampleRegenQuotes((prev) => {
        if (!(sampleJobId in prev)) return prev;
        const next = { ...prev };
        delete next[sampleJobId];
        return next;
      });
    };
    const dispatched = submitStoryboardTask(
      {
        kind: 'regenerate-sample',
        sampleJobId,
        expectedCredits: quote.credits,
        quoteRevision: quote.revision,
        onAccepted: () => {
          sampleRegenAttemptedJobIdsRef.current.add(sampleJobId);
          clearSubmitting();
          window.setTimeout(() => {
            if (currentId) void hostRef.current.flushCanvasSave(currentId).catch(() => {});
          }, 0);
          showToast('success', `已提交样片重新生成，预计消耗 ${quote.credits} 积分；已创建新卡，旧结果保留`);
        },
      },
      {
        targetNodeId: regenNodeId,
        seedTarget: {
          role: 'result-placeholder',
          x: Math.round(origin.position.x),
          y: Math.round(origin.position.y + box.height + 60),
          width: Math.round(box.width),
          height: Math.round(box.height),
          name: '样片生成中',
        },
      },
      {
        removePlaceholder,
        markUnknown,
        refreshQuote,
        unknownToast: '无法确认重新生成任务是否已提交，状态核对中，请勿重复提交',
        onFailure: clearSubmitting,
      },
    );
    if (!dispatched) {
      clearSubmitting();
      mediaNodesRef.current = mediaNodesRef.current.filter((n) => n.id !== regenNodeId);
      setMediaNodes(mediaNodesRef.current);
    }
    return dispatched;
  };

  useEffect(() => {
    const { currentId, mediaNodes } = hostRef.current;
    if (!currentId) return;
    for (const n of mediaNodes) {
      const d = (n.data ?? {}) as Record<string, unknown>;
      if (d.videoStage !== 'sample' || d.jobId == null) continue;
      if (d.genStatus != null || d.draft === true) continue;
      const jobId = String(d.jobId);
      if (finalizeAttemptedJobIdsRef.current.has(jobId)) continue;
      if (
        mediaNodes.some(
          (m) =>
            ((m.data ?? {}) as Record<string, unknown>).videoStage === 'final'
            && String(((m.data ?? {}) as Record<string, unknown>).sourceSampleJobId ?? '') === jobId,
        )
      ) continue;
      if (finalizeUnknownSamples.has(n.id)) continue;
      if (finalizeQuotes[n.id] != null || finalizeQuoteInflightRef.current.has(n.id)) continue;
      if (typeof d.finalizeDeadlineAt !== 'string' || sampleDeadlineExpired(d.finalizeDeadlineAt)) continue;
      const nodeId = n.id;
      finalizeQuoteInflightRef.current.add(nodeId);
      quoteVideoFinalize(currentId, jobId, { silent: true })
        .then((q) => {
          setFinalizeQuotes((prev) => ({
            ...prev,
            [nodeId]: q.credits != null && q.quote_revision != null
              ? { phase: 'ready', credits: q.credits, revision: q.quote_revision }
              : { phase: 'empty' },
          }));
        })
        .catch(() => {
          setFinalizeQuotes((prev) => ({ ...prev, [nodeId]: { phase: 'empty' } }));
        })
        .finally(() => {
          finalizeQuoteInflightRef.current.delete(nodeId);
        });
    }
  }, [host.mediaNodes, host.currentId, finalizeQuotes, finalizeUnknownSamples]);

  useEffect(() => {
    const { currentId, mediaNodes } = hostRef.current;
    if (!currentId) return;
    for (const n of mediaNodes) {
      const sampleJobId = regenEntrySampleJobIdOf((n.data ?? {}) as Record<string, unknown>);
      if (sampleJobId == null) continue;
      if (sampleRegenAttemptedJobIdsRef.current.has(sampleJobId)) continue;
      if (sampleRegenUnknownSamples.has(sampleJobId)) continue;
      if (sampleRegenQuotes[sampleJobId] != null || sampleRegenQuoteInflightRef.current.has(sampleJobId)) continue;
      sampleRegenQuoteInflightRef.current.add(sampleJobId);
      quoteSampleRegenerate(currentId, sampleJobId, { silent: true })
        .then((q) => {
          setSampleRegenQuotes((prev) => ({
            ...prev,
            [sampleJobId]: q.credits != null && q.quote_revision != null
              ? { phase: 'ready', credits: q.credits, revision: q.quote_revision }
              : { phase: 'empty' },
          }));
        })
        .catch(() => {
          setSampleRegenQuotes((prev) => ({ ...prev, [sampleJobId]: { phase: 'empty' } }));
        })
        .finally(() => {
          sampleRegenQuoteInflightRef.current.delete(sampleJobId);
        });
    }
  }, [host.mediaNodes, host.currentId, sampleRegenQuotes, sampleRegenUnknownSamples]);

  const finalizeCtaByNodeId = new Map<string, FinalizeCtaState>();
  const regenerateCtaByNodeId = new Map<string, RegenerateCtaState>();
  {
    const { currentId, mediaNodes } = hostRef.current;
    if (currentId) {
      for (const n of mediaNodes) {
        const d = (n.data ?? {}) as Record<string, unknown>;
        if (d.videoStage !== 'sample' || d.jobId == null) continue;
        if (d.genStatus != null || d.draft === true) continue;
        const jobId = String(d.jobId);
        const finalNode = mediaNodes.find(
          (m) =>
            ((m.data ?? {}) as Record<string, unknown>).videoStage === 'final'
            && String(((m.data ?? {}) as Record<string, unknown>).sourceSampleJobId ?? '') === jobId,
        );
        if (finalizeUnknownSamples.has(n.id)) {
          finalizeCtaByNodeId.set(n.id, { phase: 'checking' });
          continue;
        }
        const finalGen = (finalNode?.data ?? {}) as Record<string, unknown> | undefined;
        if (finalGen?.genStatus === 'generating') {
          finalizeCtaByNodeId.set(n.id, { phase: 'running' });
          continue;
        }
        if (finalGen?.genStatus === 'checking') {
          finalizeCtaByNodeId.set(n.id, { phase: 'checking' });
          continue;
        }
        if (finalNode != null || finalizeAttemptedJobIdsRef.current.has(jobId)) {
          continue;
        }
        if (typeof d.finalizeDeadlineAt !== 'string' || sampleDeadlineExpired(d.finalizeDeadlineAt)) {
          finalizeCtaByNodeId.set(n.id, { phase: 'expired' });
          continue;
        }
        const quote = finalizeQuotes[n.id];
        finalizeCtaByNodeId.set(n.id, quote == null
          ? { phase: 'loading' }
          : quote.phase === 'ready'
            ? { phase: 'ready', credits: quote.credits }
            : { phase: 'unavailable' });
      }
      for (const n of mediaNodes) {
        const sampleJobId = regenEntrySampleJobIdOf((n.data ?? {}) as Record<string, unknown>);
        if (sampleJobId == null) continue;
        if (sampleRegenUnknownSamples.has(sampleJobId)) {
          regenerateCtaByNodeId.set(n.id, { phase: 'checking' });
          continue;
        }
        if (sampleRegenAttemptedJobIdsRef.current.has(sampleJobId)) continue;
        const quote = sampleRegenQuotes[sampleJobId];
        regenerateCtaByNodeId.set(n.id, quote == null
          ? { phase: 'loading' }
          : quote.phase === 'ready'
            ? { phase: 'ready', credits: quote.credits }
            : { phase: 'unavailable' });
      }
    }
  }

  const startGenerationJob = (
    type: 'image' | 'video' | 'audio',
    parameters: ImageJobParameters | VideoJobParameters | AudioJobParameters,
    inputAssetIds?: string[],
    videoRefs?: {
      references?: GenerationRefItem[];
      firstFrameAssetId?: string;
      lastFrameAssetId?: string;
      referenceAssetIds?: string[];
      firstFrameMaterialId?: string;
      lastFrameMaterialId?: string;
      referenceMaterials?: Array<{ id: string; type: 'image' | 'video' }>;
    },
    targetNodeId?: string,
    initialDraft?: {
      mode?: string;
      references: Array<{
        assetId: string;
        url: string;
        name: string;
        mediaType: 'image' | 'video';
        role: VideoRefRole;
        materialId?: string;
      }>;
      expectedCredits?: number;
      quoteRevision?: string;
    },
    promptDoc?: PromptDoc | null,
  ): boolean => {
    const {
      currentId, mediaNodesRef, edgesRef, generationRuntimeRef, setMediaNodes, setEdges,
      actionsRef, toolMode, attachCallbacks, patchMediaNode, dockCallbacks,
      textAttachmentsForSend, handleMediaDims, handleSaveMediaToAssets, blockInvalidDraft, spawnPosition,
      addCanvasEdge,
    } = hostRef.current;
    const draftModeOfNode = (nodeId: string, data?: Record<string, unknown>) =>
      draftModeOfNodeIn(nodeId, mediaNodesRef, edgesRef, data);
    if (!currentId) {
      console.warn('未选中项目，无法创建生成任务');
      return false;
    }
    const isSampleJob = (parameters as VideoJobParameters).sample_mode === true;
    if (targetNodeId && blockInvalidDraft(edgesRef.current.filter(e => e.target === targetNodeId).map(e => e.source))) return false;
    if (blockIfCreditsInsufficient()) return false;
    const targetNode = targetNodeId ? mediaNodesRef.current.find((n) => n.id === targetNodeId) : undefined;
    const targetData = (targetNode?.data ?? {}) as Record<string, unknown>;
    const targetIsTwoStage = targetData.videoStage === 'sample' || targetData.videoStage === 'final';
    const inPlaceNode = !targetIsTwoStage && targetNodeId
      ? mediaNodesRef.current.find((n) => n.id === targetNodeId && isInPlaceRegenTarget(n))
      : undefined;
    const inPlaceNodeId = inPlaceNode?.id;
    if (inPlaceNodeId) {
      const isDraftTarget =
        ((inPlaceNode!.data ?? {}) as Record<string, unknown>).draft === true;
      const customNamed = hasCustomName(inPlaceNode);
      const existingDraftMode = draftModeOfNode(inPlaceNodeId, inPlaceNode!.data as Record<string, unknown>);
      const fallbackDraftMode = existingDraftMode ?? normalizeVideoMode(initialDraft?.mode);
      patchMediaNode(inPlaceNodeId, {
        genStatus: 'generating',
        progress: 0,
        errorText: undefined,
        errorCode: undefined,
        ...(isDraftTarget && !customNamed
          ? {
              fileName:
                type === 'video' ? (isSampleJob ? '样片生成中' : '视频生成中') : type === 'audio' ? '音频生成中' : '图片生成中',
            }
          : {}),
        prompt: parameters.prompt,
        targetRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        ...(fallbackDraftMode != null ? { draftMode: fallbackDraftMode } : {}),
        videoStage: isSampleJob ? 'sample' : undefined,
      });
    }
    const nodeId = inPlaceNodeId ?? newNodeId('media-gen');
    const placeholderPosition = targetIsTwoStage && targetNode
      ? (() => {
        const box = mediaContentBox({
          mediaType: 'video',
          width: typeof targetData.width === 'number' ? targetData.width : undefined,
          height: typeof targetData.height === 'number' ? targetData.height : undefined,
          ratio: typeof targetData.targetRatio === 'string' ? targetData.targetRatio : undefined,
        });
        return { x: Math.round(targetNode.position.x), y: Math.round(targetNode.position.y + box.height + 60) };
      })()
      : spawnPosition();
    if (!inPlaceNodeId) {
    const referenceNodes: Node[] = [];
    for (const ref of initialDraft?.references ?? []) {
      let source = [...mediaNodesRef.current, ...referenceNodes].find(n =>
        readAssetId(n.data) === ref.assetId && videoRefSourceError(n, ref.role) === null);
      if (!source) {
        source = attachCallbacks({
          id: newNodeId('media'), type: 'mediaNode', position: spawnPosition(),
          data: {
            src: ref.url,
            fileName: ref.name,
            mediaType: ref.mediaType,
            assetId: ref.assetId,
            ...(ref.materialId ? { materialId: ref.materialId, compliancePassed: true } : {}),
          },
        });
        referenceNodes.push(source);
      } else if (ref.materialId) {
        patchMediaNode(source.id, { materialId: ref.materialId, compliancePassed: true });
      }
      addCanvasEdge(source.id, nodeId, ref.role);
    }
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: placeholderPosition,
      data: {
        genStatus: 'generating',
        progress: 0,
        mediaType: type,
        fileName: type === 'video' ? (isSampleJob ? '样片生成中' : '视频生成中') : type === 'audio' ? '音频生成中' : '图片生成中',
        prompt: parameters.prompt,
        draftModelId: parameters.model_id,
        draftRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        draftSize: 'size' in parameters ? parameters.size : 'resolution' in parameters ? parameters.resolution : undefined,
        draftDuration: 'duration' in parameters ? parameters.duration : undefined,
        videoStage: isSampleJob ? 'sample' : undefined,
        ...(initialDraft?.mode != null ? { draftMode: initialDraft.mode } : {}),
        targetRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        toolMode,
        onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        ...dockCallbacks,
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    setMediaNodes((prev) => [...prev, ...referenceNodes, node]);
    }
    const jobRefs = videoRefs?.references;
    const sendPrompt = promptDoc ? flattenPromptDocForSend(promptDoc) : parameters.prompt;
    const sendAttachments = targetNodeId ? textAttachmentsForSend(targetNodeId) : undefined;
    const jobPrompt = composeImageSendPrompt(sendAttachments, sendPrompt, promptDoc);
    try {
      const payload: CreateJobPayload = {
        type,
        expected_output_count: 1,
        parameters: {
          ...parameters,
          prompt: jobPrompt,
        },
        ...(inputAssetIds?.length ? { input_asset_ids: inputAssetIds } : {}),
        ...(jobRefs && jobRefs.length > 0
          ? { references: jobRefs }
          : type === 'image' || type === 'audio'
            ? {}
            : {
                first_frame_asset_id: videoRefs?.firstFrameAssetId,
                last_frame_asset_id: videoRefs?.lastFrameAssetId,
                reference_asset_ids: videoRefs?.referenceAssetIds?.length
                  ? videoRefs.referenceAssetIds
                  : undefined,
                first_frame_material_id: videoRefs?.firstFrameMaterialId,
                last_frame_material_id: videoRefs?.lastFrameMaterialId,
                reference_materials: videoRefs?.referenceMaterials?.length
                  ? videoRefs.referenceMaterials
                  : undefined,
              }),
        ...(targetNodeId ? { target_node_id: targetNodeId } : {}),
        ...(isSampleJob && initialDraft?.expectedCredits != null && initialDraft?.quoteRevision
          ? { expected_credits: initialDraft.expectedCredits, quote_revision: initialDraft.quoteRevision }
          : {}),
      };
      let seedTarget: RecoverySeedTarget;
      if (inPlaceNode) {
        const d = (inPlaceNode.data ?? {}) as Record<string, unknown>;
        seedTarget = {
          role: d.draft === true
            ? 'draft'
            : typeof d.assetId === 'string' && d.assetId.length > 0
              ? 'existing-media'
              : 'result-placeholder',
          x: Math.round(inPlaceNode.position.x),
          y: Math.round(inPlaceNode.position.y),
          width: typeof d.width === 'number' && d.width > 0 ? d.width : 320,
          height: typeof d.height === 'number' && d.height > 0 ? d.height : 320,
          name: typeof d.fileName === 'string' ? d.fileName : '',
        };
      } else {
        const box = mediaContentBox({
          mediaType: type,
          ratio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        });
        seedTarget = {
          role: 'result-placeholder',
          x: placeholderPosition.x,
          y: placeholderPosition.y,
          width: Math.round(box.width),
          height: Math.round(box.height),
          name: type === 'video' ? (isSampleJob ? '样片生成中' : '视频生成中') : type === 'audio' ? '音频生成中' : '图片生成中',
        };
      }
      const seedSources: RecoverySeedSource[] = edgesRef.current
        .filter((edge) => edge.target === nodeId)
        .map((edge) => mediaNodesRef.current.find((n) => n.id === edge.source))
        .filter((n): n is Node => n != null)
        .map((n) => {
          const d = (n.data ?? {}) as Record<string, unknown>;
          return {
            node_id: n.id,
            x: Math.round(n.position.x),
            y: Math.round(n.position.y),
            width: typeof d.width === 'number' && d.width > 0 ? d.width : 320,
            height: typeof d.height === 'number' && d.height > 0 ? d.height : 320,
            name: typeof d.fileName === 'string' ? d.fileName : '',
          };
        });
      const runtime = generationRuntimeRef.current;
      if (!runtime) {
        console.warn('[canvas] 生成任务运行时未就绪，提交被拒绝');
        return false;
      }
      return runtime.submit(
        normalGenerationTask,
        {
          payload,
          target: {
            targetNodeId: nodeId,
            seedTarget,
            seedSources,
            expectedBindingRevision: runtime.bindingRevisionOf(nodeId),
          },
        },
        {
          onCreateFailure: (e: unknown) => {
            const rollbackInPlace = () => {
              const rollbackNode = mediaNodesRef.current.find((n) => n.id === nodeId);
              if (!rollbackNode) return;
              if (((rollbackNode.data ?? {}) as Record<string, unknown>).draft === true) {
                patchMediaNode(nodeId, {
                  genStatus: 'draft',
                  progress: undefined,
                  ...(hasCustomName(rollbackNode) ? {} : { fileName: draftFileNameOf(type) }),
                });
              } else {
                patchMediaNode(nodeId, { genStatus: undefined, progress: undefined, errorText: undefined });
              }
            };
            const removePlaceholder = () => {
              setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
              setEdges(prev => prev.filter(edge => edge.target !== nodeId));
            };
            if (openRechargeForCreditsError(e)) {
              if (inPlaceNodeId) rollbackInPlace();
              else removePlaceholder();
              return true;
            }
            if (isApiError(e) && e.status === 401) {
              if (inPlaceNodeId) rollbackInPlace();
              else {
                patchMediaNode(nodeId, {
                  draft: true,
                  genStatus: 'draft',
                  progress: undefined,
                  errorText: undefined,
                  fileName: draftFileNameOf(type),
                });
              }
              return true;
            }
            return false;
          },
        },
      );
    } catch (e: unknown) {
      patchMediaNode(nodeId, {
        genStatus: 'failed',
        errorText: isApiError(e) ? e.message : '创建任务失败',
        errorCode: isApiError(e) ? envelopeErrorCode(e) : undefined,
      });
      return false;
    }
  };

  return {
    startGenerationJob,
    handleFinalizeSample,
    handleRegenerateSample,
    regenEntrySampleJobIdOf,
    finalizeCtaByNodeId,
    regenerateCtaByNodeId,
  };
}
