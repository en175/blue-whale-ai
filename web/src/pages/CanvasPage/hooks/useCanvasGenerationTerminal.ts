import { useCallback, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import { fetchJobStatus, readJobFailText } from '@/api/jobs';
import type { SnapshotAsset } from '@/api/projects';
import { audioMixTerminalPatch, isAudioMixNodeId } from '../audioMix';
import { audioSpeedTerminalPatch, isAudioSpeedNodeId } from '../audioSpeed';
import { audioTrimTerminalPatch, isAudioTrimNodeId } from '../audioTrim';
import { audioVideoMuxErrorText, audioVideoMuxIdentityOf, audioVideoMuxResultName } from '../audioVideoMux';
import { draftFileNameOf, hasCustomName } from '../canvasNodeUtils';
import { frameInterpolationErrorText } from '../frameInterpolation';
import type { GenerationRuntime } from '../generationRuntime/runtime';
import { cancelledTerminalAction } from '../mediaReEdit';
import { isMediaExtractNodeId, mediaExtractTerminalPatch } from '../mediaExtract';
import { sceneSplitErrorText } from '../sceneSplit';
import { smartMattingErrorText, type SmartMattingIdentity } from '../smartMatting';
import { nextUsedInputState } from '../textIndexSync';
import { videoEnhanceErrorText } from '../videoEnhance';
import { isVocalSplitNodeId, vocalSplitTerminalPatch } from '../vocalSplit';

export type JobTerminalDetail = Awaited<ReturnType<typeof fetchJobStatus>>;

export interface GeneratedAssetInput {
  id?: string;
  url?: string;
  type?: string;
  width?: number | null;
  height?: number | null;
}

export interface CanvasGenerationTerminalHost {
  mediaNodesRef: RefObject<Node[]>;
  locallyRemovedGenerationNodesRef: RefObject<Set<string>>;
  pendingDeleteJobNodesRef: RefObject<Set<string>>;
  settledExtractNodesRef: RefObject<Set<string>>;
  activeJobByNodeRef: RefObject<Map<string, string>>;
  generationRuntimeRef: RefObject<GenerationRuntime | null>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  upsertAssets?: (items: SnapshotAsset[]) => void;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  removeAudioMixCardNow: (nodeId: string) => void;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  fanOutSceneSplitSegments: (nodeId: string, jobId: number | string, detail: JobTerminalDetail) => void;
  fanOutVocalSplitTracks: (nodeId: string, detail: JobTerminalDetail) => void;
}

export interface CanvasGenerationTerminalHandles {
  applyJobTerminal: (nodeId: string, jobId: number | string, detail: JobTerminalDetail) => 'terminal' | 'processing';
  settleCancelledNode: (nodeId: string) => void;
  jobResponseGuarded: (nodeId: string, jobId: number | string) => boolean;
  rememberGeneratedAsset: (asset: GeneratedAssetInput | null | undefined, fallbackType: 'image' | 'video' | 'audio') => void;
}

export function useCanvasGenerationTerminal(host: CanvasGenerationTerminalHost): CanvasGenerationTerminalHandles {
  const hostRef = useRef(host);
  hostRef.current = host;

  const rememberGeneratedAsset = useCallback((asset: GeneratedAssetInput | null | undefined, fallbackType: 'image' | 'video' | 'audio') => {
    const upsertAssets = hostRef.current.upsertAssets;
    if (!asset?.id || !asset.url || typeof upsertAssets !== 'function') return;
    const type = asset.type === 'audio' || asset.type === 'video' || asset.type === 'image'
      ? asset.type
      : fallbackType;
    upsertAssets([{
      asset_id: Number(asset.id),
      type,
      access_url: asset.url,
      width: typeof asset.width === 'number' ? asset.width : null,
      height: typeof asset.height === 'number' ? asset.height : null,
      material_id: null,
      material_status: null,
    }]);
  }, []);

  const jobResponseGuarded = useCallback((nodeId: string, jobId: number | string): boolean => {
    const { locallyRemovedGenerationNodesRef, mediaNodesRef, activeJobByNodeRef } = hostRef.current;
    return !locallyRemovedGenerationNodesRef.current.has(nodeId) &&
      mediaNodesRef.current.some((n) => n.id === nodeId) &&
      activeJobByNodeRef.current.get(nodeId) === String(jobId);
  }, []);

  const settleCancelledNode = useCallback((nodeId: string) => {
    const {
      mediaNodesRef, pendingDeleteJobNodesRef, locallyRemovedGenerationNodesRef,
      setMediaNodes, patchMediaNode, removeAudioMixCardNow,
    } = hostRef.current;
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    if (pendingDeleteJobNodesRef.current.has(nodeId)) {
      pendingDeleteJobNodesRef.current.delete(nodeId);
      locallyRemovedGenerationNodesRef.current.add(nodeId);
      if (isAudioMixNodeId(nodeId)) {
        removeAudioMixCardNow(nodeId);
        return;
      }
      setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
      return;
    }
    const action = cancelledTerminalAction(node);
    if (action === 'to-draft') {
      patchMediaNode(nodeId, {
        genStatus: 'draft',
        progress: undefined,
        errorText: undefined,
        ...(hasCustomName(node) ? {} : { fileName: draftFileNameOf(node.data?.mediaType) }),
      });
      return;
    }
    if (action === 'restore') {
      patchMediaNode(nodeId, { genStatus: undefined, progress: undefined, errorText: undefined });
      return;
    }
    locallyRemovedGenerationNodesRef.current.add(nodeId);
    setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
  }, []);

  const applyJobTerminal = useCallback((nodeId: string, jobId: number | string, detail: JobTerminalDetail): 'terminal' | 'processing' => {
    const {
      mediaNodesRef, pendingDeleteJobNodesRef, locallyRemovedGenerationNodesRef, settledExtractNodesRef,
      generationRuntimeRef, setMediaNodes, patchMediaNode, removeAudioMixCardNow, showToast,
      fanOutSceneSplitSegments, fanOutVocalSplitTracks,
    } = hostRef.current;
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return 'terminal';
    const removeWithPendingDelete = () => {
      pendingDeleteJobNodesRef.current.delete(nodeId);
      locallyRemovedGenerationNodesRef.current.add(nodeId);
      if (isAudioMixNodeId(nodeId)) {
        removeAudioMixCardNow(nodeId);
        return;
      }
      setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
    };
    if (((node.data ?? {}) as Record<string, unknown>).sceneSplit != null) {
      if (detail.status === 'succeeded') {
        if (generationRuntimeRef.current?.statusOf(nodeId)?.submissionId == null) {
          fanOutSceneSplitSegments(nodeId, jobId, detail);
        }
        return 'terminal';
      }
      if (detail.status === 'failed') {
        patchMediaNode(nodeId, {
          genStatus: 'failed',
          errorText: sceneSplitErrorText(detail.error),
        });
        return 'terminal';
      }
    }
    if (((node.data ?? {}) as Record<string, unknown>).smartMatting != null) {
      if (detail.status === 'succeeded') {
        const mattingIdentity = ((node.data ?? {}) as Record<string, unknown>).smartMatting as
          | SmartMattingIdentity
          | undefined;
        const transparent = mattingIdentity?.lastInput?.format === 'WEBM';
        rememberGeneratedAsset(detail.asset, 'video');
        patchMediaNode(nodeId, {
          genStatus: undefined,
          progress: 100,
          errorText: undefined,
          src: detail.asset?.url ?? '',
          mediaType: 'video',
          assetId: detail.asset?.id,
          width: detail.asset?.width ?? undefined,
          height: detail.asset?.height ?? undefined,
          duration: detail.asset?.duration ?? undefined,
          transparentOutput: transparent ? true : undefined,
          smartMatting: undefined,
        });
        return 'terminal';
      }
      if (detail.status === 'failed') {
        patchMediaNode(nodeId, {
          genStatus: 'failed',
          errorText: smartMattingErrorText(detail.error),
        });
        return 'terminal';
      }
    }
    if (isMediaExtractNodeId(nodeId)) {
      const extractPatch = mediaExtractTerminalPatch(
        detail,
        typeof node.data?.fileName === 'string' ? node.data.fileName : undefined,
      );
      if (extractPatch) {
        settledExtractNodesRef.current.add(nodeId);
        if (detail.status === 'succeeded') rememberGeneratedAsset(detail.asset, 'audio');
        patchMediaNode(nodeId, extractPatch);
        return 'terminal';
      }
    }
    if (isAudioTrimNodeId(nodeId)) {
      const trimPatch = audioTrimTerminalPatch(
        detail,
        typeof node.data?.fileName === 'string' ? node.data.fileName : undefined,
      );
      if (trimPatch) {
        settledExtractNodesRef.current.add(nodeId);
        if (detail.status === 'succeeded') rememberGeneratedAsset(detail.asset, 'audio');
        patchMediaNode(nodeId, trimPatch);
        return 'terminal';
      }
    }
    if (isAudioMixNodeId(nodeId)) {
      const mixPatch = audioMixTerminalPatch(detail);
      if (mixPatch) {
        if (pendingDeleteJobNodesRef.current.has(nodeId) || node.data.audioMixCancelPending === true) {
          if (detail.status === 'failed' || detail.status === 'cancelled') {
            removeWithPendingDelete();
            return 'terminal';
          }
          if (detail.status === 'succeeded') {
            pendingDeleteJobNodesRef.current.delete(nodeId);
            showToast('warn', '任务已完成，已停止删除；如需删除请再次操作');
          }
        }
        settledExtractNodesRef.current.add(nodeId);
        if (detail.status === 'succeeded') rememberGeneratedAsset(detail.asset, 'audio');
        patchMediaNode(nodeId, { ...mixPatch, audioMixCancelPending: undefined });
        return 'terminal';
      }
    }
    if (isAudioSpeedNodeId(nodeId)) {
      const speedPatch = audioSpeedTerminalPatch(
        detail,
        typeof node.data?.fileName === 'string' ? node.data.fileName : undefined,
      );
      if (speedPatch) {
        settledExtractNodesRef.current.add(nodeId);
        patchMediaNode(nodeId, speedPatch);
        return 'terminal';
      }
    }
    if (isVocalSplitNodeId(nodeId)) {
      if (detail.status === 'succeeded') {
        if (generationRuntimeRef.current?.statusOf(nodeId)?.submissionId == null) {
          settledExtractNodesRef.current.add(nodeId);
          fanOutVocalSplitTracks(nodeId, detail);
        }
        return 'terminal';
      }
      const vocalPatch = vocalSplitTerminalPatch(detail);
      if (vocalPatch) {
        settledExtractNodesRef.current.add(nodeId);
        patchMediaNode(nodeId, vocalPatch);
        return 'terminal';
      }
    }
    if (detail.status === 'succeeded') {
      const originalType = node.data?.mediaType;
      const assetType = detail.asset?.type;
      const wasFrameInterpolation = ((node.data ?? {}) as Record<string, unknown>).frameInterpolation != null;
      const muxIdentity = audioVideoMuxIdentityOf(node);
      const mediaType = (assetType === 'audio' || assetType === 'video' || assetType === 'image')
        ? assetType
        : (originalType === 'audio' || originalType === 'video' || originalType === 'image')
          ? originalType
          : 'image';
      rememberGeneratedAsset(detail.asset, mediaType);
      patchMediaNode(nodeId, {
        genStatus: undefined,
        progress: 100,
        errorText: undefined,
        errorCode: undefined,
        src: detail.asset?.url ?? '',
        mediaType: (assetType === 'audio' || assetType === 'video' || assetType === 'image')
          ? assetType
          : (originalType ?? 'image'),
        ...(hasCustomName(node)
          ? {}
          : { fileName: muxIdentity ? audioVideoMuxResultName(muxIdentity.video?.name) : `生成-${jobId}` }),
        assetId: detail.asset?.id,
        width: detail.asset?.width ?? muxIdentity?.video?.width ?? undefined,
        height: detail.asset?.height ?? muxIdentity?.video?.height ?? undefined,
        duration: detail.asset?.duration ?? muxIdentity?.video?.duration ?? undefined,
        draft: undefined,
        ...(wasFrameInterpolation ? { frameInterpolation: undefined } : {}),
        ...(muxIdentity ? { audioVideoMux: undefined } : {}),
        videoStage: detail.video_stage === 'sample' ? 'sample' : detail.video_stage === 'final' ? 'final' : undefined,
        finalizeDeadlineAt: detail.video_stage === 'sample' ? (detail.finalize_deadline_at ?? null) : undefined,
        ...(detail.video_stage === 'final' && detail.source_sample_job_id != null
          ? { sourceSampleJobId: detail.source_sample_job_id }
          : {}),
        chargeState: detail.charge_state ?? undefined,
        actualCredits: detail.actual_credits ?? undefined,
      });
      const nextUsed = nextUsedInputState((node.data ?? {}) as Record<string, unknown>, detail.text_input_signature, jobId);
      if (nextUsed) patchMediaNode(nodeId, nextUsed);
      if (pendingDeleteJobNodesRef.current.has(nodeId)) {
        pendingDeleteJobNodesRef.current.delete(nodeId);
        showToast('warn', '任务已完成，已停止删除；如需删除请再次操作');
      }
      return 'terminal';
    }
    if (detail.status === 'failed') {
      if (pendingDeleteJobNodesRef.current.has(nodeId)) {
        removeWithPendingDelete();
        return 'terminal';
      }
      patchMediaNode(nodeId, {
        genStatus: 'failed',
        errorText: ((node.data ?? {}) as Record<string, unknown>).videoEnhance
          ? videoEnhanceErrorText(detail.error)
          : ((node.data ?? {}) as Record<string, unknown>).frameInterpolation
            ? frameInterpolationErrorText(detail.error)
            : audioVideoMuxIdentityOf(node)
              ? audioVideoMuxErrorText(detail.error)
              : readJobFailText(detail.error),
        videoStage: detail.video_stage === 'sample' ? 'sample' : detail.video_stage === 'final' ? 'final' : undefined,
        finalizeDeadlineAt: undefined,
        ...(detail.video_stage === 'final' && detail.source_sample_job_id != null
          ? { sourceSampleJobId: detail.source_sample_job_id }
          : {}),
        chargeState: detail.charge_state ?? undefined,
        actualCredits: detail.actual_credits ?? undefined,
        errorCode: detail.error?.code,
      });
      return 'terminal';
    }
    if (detail.status === 'checking') {
      patchMediaNode(nodeId, { genStatus: 'checking', progress: undefined });
      return 'processing';
    }
    if (detail.status === 'cancelled') {
      settleCancelledNode(nodeId);
      return 'terminal';
    }
    return 'processing';
  }, [rememberGeneratedAsset, settleCancelledNode]);

  return { applyJobTerminal, settleCancelledNode, jobResponseGuarded, rememberGeneratedAsset };
}
