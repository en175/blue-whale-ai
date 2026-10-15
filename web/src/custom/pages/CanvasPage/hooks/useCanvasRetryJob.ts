import type { RefObject } from 'react';
import type { Node } from '@xyflow/react';
import { apiErrorMessage, isSilentAuthError } from '../toolSessionCapture';
import { isAudioMixNodeId } from '../audioMix';
import { audioVideoMuxIdentityOf } from '../audioVideoMux';
import { isImageToolsCard, imageToolsRetryPayloadOf, type ImageToolsPayload } from '../generationRuntime/imageTools';
import { videoToolFrozenPayload } from '../generationRuntime/videoTools';
import type { RecoverySeedSource, RecoverySeedTarget } from '../generationRuntime/types';
import type { FrameInterpolationIdentity } from '../frameInterpolation';
import type { VideoEnhanceIdentity } from '../videoEnhance';

export interface CanvasRetryJobHost {
  currentId: string;
  mediaNodesRef: RefObject<Node[]>;
  generationRuntimeRef: RefObject<{
    statusOf: (nodeId: string) => { phase: string } | null | undefined;
    retry: (nodeId: string, options?: Record<string, unknown>) => void;
    claims: (nodeId: string, data: Record<string, unknown>) => boolean;
  } | null>;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  isVideoEnhanceCardInFlight: (nodeId: string) => boolean;
  imageToolTargetOfNode: (nodeId: string) => { targetNodeId: string; seedTarget: RecoverySeedTarget; seedSources: RecoverySeedSource[] } | null;
  dispatchImageToolTask: (
    payload: ImageToolsPayload,
    target: { targetNodeId: string; seedTarget: RecoverySeedTarget; seedSources: RecoverySeedSource[] },
  ) => Promise<string>;
  beginVideoEnhanceSubmission: (nodeId: string) => (() => void) | null;
  captureSessionOwnership: (kind: 'videoEnhance') => (() => boolean) | null;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

export interface CanvasRetryJobHandles {
  handleRetryJob: (nodeId: string) => void;
}

export function useCanvasRetryJob(host: CanvasRetryJobHost): CanvasRetryJobHandles {
  const {
    currentId,
    mediaNodesRef,
    generationRuntimeRef,
    patchMediaNode,
    isVideoEnhanceCardInFlight,
    imageToolTargetOfNode,
    dispatchImageToolTask,
    beginVideoEnhanceSubmission,
    captureSessionOwnership,
    showToast,
  } = host;

  const handleRetryJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | string | undefined;
    if (node && (isAudioMixNodeId(nodeId) || audioVideoMuxIdentityOf(node) != null)) {
      if (!currentId) {
        showToast('warn', '未选中项目，无法重试');
        return;
      }
      const inFlight = generationRuntimeRef.current?.statusOf(nodeId);
      if (inFlight && (inFlight.phase === 'submitting' || inFlight.phase === 'generating')) return;
      generationRuntimeRef.current?.retry(nodeId);
      return;
    }
    if (node && isImageToolsCard(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      if (jobId != null) {
        generationRuntimeRef.current?.retry(nodeId);
        return;
      }
      const payload = imageToolsRetryPayloadOf(nodeId, (node.data ?? {}) as Record<string, unknown>);
      if (!payload) {
        showToast('warn', '原任务输入已不可信，请重新编辑后再发送');
        return;
      }
      const target = imageToolTargetOfNode(nodeId);
      if (!target) return;
      patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '', errorCode: undefined });
      dispatchImageToolTask(payload, target).catch(() => {});
      return;
    }
    if (node && generationRuntimeRef.current?.claims(nodeId, (node.data ?? {}) as Record<string, unknown>)) {
      if (!currentId) {
        showToast('warn', '未选中项目，无法重试');
        return;
      }
      const hdRetry = videoToolFrozenPayload(nodeId, (node.data ?? {}) as Record<string, unknown>)?.kind === 'videoEnhance';
      if (hdRetry && (isVideoEnhanceCardInFlight(nodeId) || node.data.genStatus === 'generating' || node.data.genStatus === 'checking')) return;
      const ownsHdSession = hdRetry ? captureSessionOwnership('videoEnhance') : null;
      const finishHd = hdRetry ? beginVideoEnhanceSubmission(nodeId) : null;
      generationRuntimeRef.current.retry(nodeId, {
        deferGeneratingUntilAccepted: hdRetry,
        onStale: () => finishHd?.(),
        onCreateFailure: hdRetry ? (error: unknown) => {
          finishHd?.();
          if (!isSilentAuthError(error) && ownsHdSession?.() && !isVideoEnhanceCardInFlight(nodeId)) {
            showToast('error', apiErrorMessage(error, 'HD 高清任务创建失败，请重试'));
          }
          return false;
        } : undefined,
        onAccepted: () => {
          finishHd?.();
          const identityData = (mediaNodesRef.current.find((n) => n.id === nodeId)?.data ?? {}) as Record<string, unknown>;
          const frozen = videoToolFrozenPayload(nodeId, identityData);
          const frameIdentity = identityData.frameInterpolation as FrameInterpolationIdentity | undefined;
          if (frameIdentity != null && frozen?.kind === 'frameInterpolation') {
            patchMediaNode(nodeId, { frameInterpolation: { ...frameIdentity, frozenParams: { fps: frozen.input.fps } } });
            return;
          }
          const hdIdentity = identityData.videoEnhance as VideoEnhanceIdentity | undefined;
          if (hdIdentity != null && frozen?.kind === 'videoEnhance') {
            patchMediaNode(nodeId, { videoEnhance: { ...hdIdentity, lastParams: { resolution: frozen.input.resolution } } });
          }
        },
      });
    }
  };

  return { handleRetryJob };
}
