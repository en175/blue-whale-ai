import type { Node } from '@xyflow/react';
import { isApiError } from '@/api/http';
import { buildImageEnhanceInput, restoreImageEnhanceParams, type ImageEnhanceIdentity, type ImageEnhancePanelParams } from './imageEnhance';
import { buildVideoEnhanceInput, restoreVideoEnhanceResolution, type VideoEnhanceIdentity } from './videoEnhance';
import type { VideoEnhanceResolution } from '@lib/contracts/video-enhance';
import { buildFrameInterpolationInput, restoreFrameInterpolationFps, type FrameInterpolationIdentity, type FrameInterpolationFps } from './frameInterpolation';
import { readAssetId } from './mediaRefs';
import { apiErrorMessage, capturePanelIdentity, isSilentAuthError } from './toolSessionCapture';
import type { ToolSessionDefinition } from './toolSessionRuntime';

import type { CanvasToolKind } from './canvasToolSessions';

interface PanelSubmission<Payload, Identity> { projectId: string; nodeId: string; payload: Payload; identity: Identity }
export type ImageEnhanceSubmission = PanelSubmission<NonNullable<ReturnType<typeof buildImageEnhanceInput>>, ImageEnhanceIdentity>;
export type VideoEnhanceSubmission = PanelSubmission<NonNullable<ReturnType<typeof buildVideoEnhanceInput>>, VideoEnhanceIdentity>;
export type FrameInterpolationSubmission = PanelSubmission<NonNullable<ReturnType<typeof buildFrameInterpolationInput>>, FrameInterpolationIdentity>;
export interface PanelToolHost {
  getProjectId(): string | null;
  getNode(nodeId: string): Node | undefined;
  getNodes(): Node[];
  canOpen(nodeId: string): boolean;
  activate(nodeId: string, toolbar: boolean): void;
  isValidTarget(nodeId: string, kind: CanvasToolKind): boolean;
  isFrameInFlight(nodeId: string): boolean;
  isVideoEnhanceInFlight(nodeId: string): boolean;
  startImage(input: ImageEnhanceSubmission): Promise<void>;
  startVideo(input: VideoEnhanceSubmission): Promise<void>;
  startFrame(input: FrameInterpolationSubmission): Promise<boolean>;
  warn(message: string): void;
  error(message: string): void;
  httpError(message: string): void;
}
export interface ImageEnhanceState { nodeId: string; seed: { ts: number; sourceDims: { width?: number; height?: number }; initialParams: ImageEnhancePanelParams | null } }
export interface VideoEnhanceState { nodeId: string; seed: { ts: number; initialResolution: VideoEnhanceResolution } }
export interface FrameInterpolationState { nodeId: string; seed: { ts: number; initialFps: FrameInterpolationFps }; inFlight: boolean }

export function captureImageEnhance(host: PanelToolHost, nodeId: string, params: ImageEnhancePanelParams): ImageEnhanceSubmission | null {
  const captured = capturePanelIdentity<ImageEnhanceIdentity>(host, nodeId, 'imageEnhance', '高清放大');
  if (!captured) return null;
  const payload = buildImageEnhanceInput(captured.identity.sourceAssetId, nodeId, params);
  if (!payload) { host.warn('高清放大参数不合法，请调整后重试'); return null; }
  return { projectId: captured.projectId, nodeId, payload, identity: captured.identity };
}
export function captureVideoEnhance(host: PanelToolHost, nodeId: string, resolution: VideoEnhanceResolution): VideoEnhanceSubmission | null {
  const captured = capturePanelIdentity<VideoEnhanceIdentity>(host, nodeId, 'videoEnhance', 'HD 高清');
  if (!captured) return null;
  const payload = buildVideoEnhanceInput(String(captured.identity.sourceAssetId), nodeId, resolution);
  if (!payload) { host.warn('HD 高清参数不合法，请调整后重试'); return null; }
  return { projectId: captured.projectId, nodeId, payload, identity: captured.identity };
}
export function captureFrameInterpolation(host: PanelToolHost, nodeId: string, fps: FrameInterpolationFps): FrameInterpolationSubmission | null {
  const captured = capturePanelIdentity<FrameInterpolationIdentity>(host, nodeId, 'frameInterpolation', '插帧');
  if (!captured) return null;
  const payload = buildFrameInterpolationInput(String(captured.identity.sourceAssetId), nodeId, fps);
  if (!payload) { host.warn('插帧参数不合法，请调整后重试'); return null; }
  if (host.isFrameInFlight(nodeId)) return null;
  return { projectId: captured.projectId, nodeId, payload, identity: captured.identity };
}

export function createVideoEnhanceSession(getHost: () => PanelToolHost): ToolSessionDefinition<VideoEnhanceState, string, VideoEnhanceSubmission, VideoEnhanceResolution> {
  return {
    kind: 'videoEnhance', panel: 'preserve',
    initialize(nodeId, previous) {
      if (!getHost().canOpen(nodeId)) return null;
      const identity = getHost().getNode(nodeId)?.data.videoEnhance as VideoEnhanceIdentity | undefined;
      const initialResolution = restoreVideoEnhanceResolution(identity?.lastParams);
      if (previous?.nodeId === nodeId) {
        return initialResolution === previous.seed.initialResolution
          ? previous
          : { ...previous, seed: { ...previous.seed, initialResolution } };
      }
      return { nodeId, seed: { ts: Date.now(), initialResolution } };
    },
    opened(state) { getHost().activate(state.nodeId, true); return state; },
    target: (state) => state.nodeId,
    capture: (state, resolution) => resolution ? captureVideoEnhance(getHost(), state.nodeId, resolution) : null,
    async submit(input, context) { await getHost().startVideo(input); context.close(); },
    inFlight: (state) => getHost().isVideoEnhanceInFlight(state.nodeId),
    onError(error) {
      if (isSilentAuthError(error)) return;
      if (isApiError(error)) getHost().httpError(error.message);
      getHost().error(apiErrorMessage(error, 'HD 高清任务创建失败，请重试'));
    },
    reconcile: (state) => getHost().isValidTarget(state.nodeId, 'videoEnhance') ? state : null,
  };
}

export function createImageEnhanceSession(getHost: () => PanelToolHost): ToolSessionDefinition<ImageEnhanceState, string, ImageEnhanceSubmission, ImageEnhancePanelParams> {
  return {
    kind: 'imageEnhance', panel: 'preserve',
    initialize(nodeId, previous) {
      const host = getHost();
      if (!host.canOpen(nodeId)) return null;
      if (previous?.nodeId === nodeId) return previous;
      const identity = host.getNode(nodeId)?.data.imageEnhance as ImageEnhanceIdentity | undefined;
      const source = identity?.sourceAssetId ? host.getNodes().find((node) => readAssetId(node.data) === identity.sourceAssetId) : undefined;
      return { nodeId, seed: {
        ts: Date.now(), sourceDims: {
          width: typeof source?.data.width === 'number' ? source.data.width : undefined,
          height: typeof source?.data.height === 'number' ? source.data.height : undefined,
        }, initialParams: identity?.lastParams ? restoreImageEnhanceParams(identity.lastParams) : null,
      } };
    },
    opened(state) { getHost().activate(state.nodeId, true); return state; },
    target: (state) => state.nodeId,
    capture: (state, params) => params ? captureImageEnhance(getHost(), state.nodeId, params) : null,
    async submit(input, context) {
      const task = getHost().startImage(input);
      context.exitForSubmission();
      await task;
    },
    onError(error) {
      if (isSilentAuthError(error)) return;
      getHost().httpError(apiErrorMessage(error, '创建任务失败'));
    },
    reconcile: (state) => getHost().isValidTarget(state.nodeId, 'imageEnhance') ? state : null,
  };
}

export class FrameInterpolationSaveError extends Error {}

export function createFrameInterpolationSession(getHost: () => PanelToolHost): ToolSessionDefinition<FrameInterpolationState, string, FrameInterpolationSubmission, FrameInterpolationFps> {
  return {
    kind: 'frameInterpolation', panel: 'reinitialize',
    initialize(nodeId) {
      const host = getHost();
      if (!host.canOpen(nodeId)) return null;
      const identity = host.getNode(nodeId)?.data.frameInterpolation as FrameInterpolationIdentity | undefined;
      return { nodeId, seed: { ts: Date.now(), initialFps: restoreFrameInterpolationFps(identity?.lastParams) }, inFlight: host.isFrameInFlight(nodeId) };
    },
    opened(state) { getHost().activate(state.nodeId, false); return state; },
    target: (state) => state.nodeId,
    capture: (state, fps) => fps ? captureFrameInterpolation(getHost(), state.nodeId, fps) : null,
    async submit(input, context) { if (await getHost().startFrame(input)) context.close(); },
    onError(error) {
      if (isSilentAuthError(error)) return;
      getHost().error(apiErrorMessage(error, '插帧任务创建失败，请重试', FrameInterpolationSaveError));
    },
    reconcile(state) {
      const host = getHost();
      if (!host.isValidTarget(state.nodeId, 'frameInterpolation')) return null;
      const inFlight = host.isFrameInFlight(state.nodeId);
      return inFlight === state.inFlight ? state : { ...state, inFlight };
    },
  };
}
