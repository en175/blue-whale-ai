import type { RefObject } from 'react';
import type { Node } from '@xyflow/react';
import { isApiError } from '@/shared/api/http';
import type { QueryClient } from '@tanstack/react-query';
import { frameInterpolationRecoveryOptions } from '@/app/api/frameInterpolationRecovery';
import { fetchJobStatus, type JobDetail } from '@/app/api/jobs';
import type { FrameInterpolationSubmission, VideoEnhanceSubmission } from '../panelToolSessions';
import type { FrameInterpolationIdentity } from '../frameInterpolation';
import type { VideoToolPayload } from '../generationRuntime/videoTools';
import type { GenerationRuntime } from '../generationRuntime/runtime';

type InFlightRequest = { projectId: string | null; loadEpoch: object };

export interface CanvasToolJobSubmissionsHost {
  activeProjectRef: RefObject<string>;
  mediaNodesRef: RefObject<Node[]>;
  activeJobByNodeRef: RefObject<Map<string, string>>;
  locallyRemovedGenerationNodesRef: RefObject<Set<string>>;
  videoEnhanceInFlightRef: RefObject<Map<string, Set<InFlightRequest>>>;
  docLoadEpochRef: RefObject<object>;
  generationRuntimeRef: RefObject<GenerationRuntime | null>;
  queryClient: QueryClient;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  toolRuntime: {
    reconcileSources: (ids: Set<string>) => void;
    notifyInFlight: (kind: string, targetId: string) => void;
  };
  submitVideoToolTask: (
    payload: VideoToolPayload,
    targetNodeId: string,
    options?: Parameters<GenerationRuntime['submit']>[2],
  ) => boolean;
  applyJobTerminal: (nodeId: string, jobId: number | string, detail: JobDetail) => string;
  settleCancelledNode: (nodeId: string) => void;
  jobResponseGuarded: (nodeId: string, jobId: number | string) => boolean;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  recoverFrameInterpolationRef: RefObject<(nodeId: string, savedJobId?: unknown) => void>;
}

export interface CanvasToolJobSubmissionsHandles {
  handleStartFrameInterpolation: (submission: FrameInterpolationSubmission) => Promise<boolean>;
  recoverFrameInterpolation: (nodeId: string, savedJobId?: unknown) => void;
  beginVideoEnhanceSubmission: (nodeId: string) => () => void;
  handleStartVideoEnhance: (submission: VideoEnhanceSubmission) => Promise<void>;
}

export function useCanvasToolJobSubmissions(host: CanvasToolJobSubmissionsHost): CanvasToolJobSubmissionsHandles {
  const {
    activeProjectRef,
    mediaNodesRef,
    activeJobByNodeRef,
    locallyRemovedGenerationNodesRef,
    videoEnhanceInFlightRef,
    docLoadEpochRef,
    generationRuntimeRef,
    queryClient,
    patchMediaNode,
    toolRuntime,
    submitVideoToolTask,
    applyJobTerminal,
    settleCancelledNode,
    jobResponseGuarded,
    showToast,
    recoverFrameInterpolationRef,
  } = host;

  const handleStartFrameInterpolation = async (submission: FrameInterpolationSubmission): Promise<boolean> => {
    const { nodeId, payload: input, identity } = submission;
    const fps = input.fps;
    toolRuntime.reconcileSources(new Set(mediaNodesRef.current.map((node) => node.id)));
    patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: undefined });
    const sent = submitVideoToolTask({ kind: 'frameInterpolation', input }, nodeId, {
      onAccepted: () => {
        const current = (mediaNodesRef.current.find((node) => node.id === nodeId)?.data.frameInterpolation as FrameInterpolationIdentity | undefined);
        patchMediaNode(nodeId, {
          frameInterpolation: { ...identity, lastParams: current?.lastParams, frozenParams: { fps } },
        });
      },
      onCreateFailure: (e: unknown) => {
        const rollback = mediaNodesRef.current.find((n) => n.id === nodeId);
        const isDraft = ((rollback?.data ?? {}) as Record<string, unknown>).draft === true;
        patchMediaNode(nodeId, { genStatus: isDraft ? 'draft' : undefined, progress: undefined, errorText: undefined });
        if (!(e as { _skipped?: boolean })._skipped) {
          showToast('error', isApiError(e) ? e.message : '插帧任务创建失败，请重试');
        }
        return true;
      },
    });
    toolRuntime.reconcileSources(new Set(mediaNodesRef.current.map((node) => node.id)));
    return sent;
  };
  const recoverFrameInterpolation = (nodeId: string, savedJobId?: unknown) => {
    const projectId = activeProjectRef.current;
    if (!projectId) return;
    const activeAtStart = activeJobByNodeRef.current.get(nodeId);
    queryClient.fetchQuery(frameInterpolationRecoveryOptions(projectId, nodeId))
      .then(({ current, input }) => {
        if (activeProjectRef.current !== projectId) return;
        const node = mediaNodesRef.current.find((n) => n.id === nodeId);
        if (!node) return;
        const data = (node.data ?? {}) as Record<string, unknown>;
        if (data.jobId !== savedJobId ||
          activeJobByNodeRef.current.get(nodeId) !== activeAtStart ||
          generationRuntimeRef.current?.statusOf(nodeId)?.phase === 'submitting' ||
          locallyRemovedGenerationNodesRef.current.has(nodeId) || !data.frameInterpolation) return;
        if (!current) return;
        if (current.status === 'cancelled') {
          activeJobByNodeRef.current.delete(nodeId);
          settleCancelledNode(nodeId);
          return;
        }
        const identity = data.frameInterpolation as FrameInterpolationIdentity;
        if (input) patchMediaNode(nodeId, {
          frameInterpolation: { ...identity, sourceAssetId: input.source_asset_id, frozenParams: { fps: input.fps }, recoveryBlocked: undefined },
        });
        else if (identity.recoveryBlocked) {
          patchMediaNode(nodeId, { frameInterpolation: { ...identity, recoveryBlocked: undefined } });
        }
        if (current.status === 'queued' || current.status === 'processing') {
          patchMediaNode(nodeId, {
            genStatus: 'generating',
            progress: current.progress,
            errorText: undefined,
            jobId: current.job_id,
          });
          generationRuntimeRef.current?.resumeFromHydration(nodeId, String(current.job_id), (node.data ?? {}) as Record<string, unknown>);
          return;
        }
        activeJobByNodeRef.current.set(nodeId, String(current.job_id));
        patchMediaNode(nodeId, { jobId: current.job_id });
        void fetchJobStatus(current.job_id)
          .then((detail) => {
            if (!jobResponseGuarded(nodeId, current.job_id)) return;
            if (applyJobTerminal(nodeId, current.job_id, detail) === 'processing') {
              patchMediaNode(nodeId, {
                genStatus: 'generating',
                progress: detail.progress,
                errorText: undefined,
              });
              generationRuntimeRef.current?.resumeFromHydration(nodeId, String(current.job_id), (node.data ?? {}) as Record<string, unknown>);
            }
          })
          .catch(() => {
            if (!jobResponseGuarded(nodeId, current.job_id)) return;
            patchMediaNode(nodeId, {
              genStatus: 'generating',
              progress: current.progress,
              errorText: undefined,
            });
            generationRuntimeRef.current?.resumeFromHydration(nodeId, String(current.job_id), (node.data ?? {}) as Record<string, unknown>);
          });
      })
      .catch((e: unknown) => {
        console.warn('[frame-interpolation] 恢复查询失败:', e);
        const failedNode = mediaNodesRef.current.find((n) => n.id === nodeId);
        const failedData = (failedNode?.data ?? {}) as Record<string, unknown>;
        const failedIdentity = failedData.frameInterpolation as FrameInterpolationIdentity | undefined;
        if (failedIdentity != null && !failedIdentity.recoveryBlocked) {
          patchMediaNode(nodeId, { frameInterpolation: { ...failedIdentity, recoveryBlocked: true } });
        }
      });
  };
  const beginVideoEnhanceSubmission = (nodeId: string) => {
    const pending = videoEnhanceInFlightRef.current.get(nodeId) ?? new Set<InFlightRequest>();
    const request = { projectId: activeProjectRef.current, loadEpoch: docLoadEpochRef.current };
    pending.add(request);
    videoEnhanceInFlightRef.current.set(nodeId, pending);
    toolRuntime.notifyInFlight('videoEnhance', nodeId);
    toolRuntime.reconcileSources(new Set(mediaNodesRef.current.map((node) => node.id)));
    return () => {
      if (!pending.delete(request)) return;
      if (pending.size === 0) videoEnhanceInFlightRef.current.delete(nodeId);
      toolRuntime.reconcileSources(new Set(mediaNodesRef.current.map((node) => node.id)));
    };
  };
  const handleStartVideoEnhance = async (submission: VideoEnhanceSubmission): Promise<void> => {
    const { nodeId, payload: input, identity } = submission;
    const finish = beginVideoEnhanceSubmission(nodeId);
    return new Promise<void>((resolve, reject) => {
      const submitted = submitVideoToolTask({ kind: 'videoEnhance', input }, nodeId, {
        replaceSubmitting: true,
        onAccepted: () => {
          finish();
          patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: undefined });
          patchMediaNode(nodeId, { videoEnhance: { ...identity, lastParams: { resolution: input.resolution } } });
          resolve();
        },
        onCreateFailure: (e: unknown) => {
          finish();
          reject(e);
          return true;
        },
        onStale: () => { finish(); resolve(); },
      });
      if (!submitted) { finish(); resolve(); }
    });
  };

  recoverFrameInterpolationRef.current = recoverFrameInterpolation;
  return { handleStartFrameInterpolation, recoverFrameInterpolation, beginVideoEnhanceSubmission, handleStartVideoEnhance };
}
