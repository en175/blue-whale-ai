import type { Node } from '@xyflow/react';
import { isApiError } from '@/api/http';
import { buildImageEnhanceInput, restoreImageEnhanceParams, type ImageEnhanceIdentity, type ImageEnhancePanelParams } from './imageEnhance';
import { buildVideoEnhanceInput, restoreVideoEnhanceResolution, type VideoEnhanceIdentity } from './videoEnhance';
import type { VideoEnhanceResolution } from '@lib/contracts/video-enhance';
import { buildFrameInterpolationInput, restoreFrameInterpolationFps, type FrameInterpolationIdentity, type FrameInterpolationFps } from './frameInterpolation';
import { readAssetId } from './mediaRefs';
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
  const projectId = host.getProjectId();
  if (!projectId) { host.warn('未选中项目，无法发起高清放大'); return null; }
  const identity = host.getNode(nodeId)?.data.imageEnhance as ImageEnhanceIdentity | undefined;
  if (!identity?.sourceAssetId) { host.warn('源素材身份缺失，无法发起高清放大'); return null; }
  const payload = buildImageEnhanceInput(identity.sourceAssetId, nodeId, params);
  if (!payload) { host.warn('高清放大参数不合法，请调整后重试'); return null; }
  return { projectId, nodeId, payload, identity: { ...identity } };
}
export function captureVideoEnhance(host: PanelToolHost, nodeId: string, resolution: VideoEnhanceResolution): VideoEnhanceSubmission | null {
  const projectId = host.getProjectId();
  if (!projectId) { host.warn('未选中项目，无法发起 HD 高清'); return null; }
  const identity = host.getNode(nodeId)?.data.videoEnhance as VideoEnhanceIdentity | undefined;
  if (!identity?.sourceAssetId) { host.warn('源素材身份缺失，无法发起 HD 高清'); return null; }
  const payload = buildVideoEnhanceInput(String(identity.sourceAssetId), nodeId, resolution);
  if (!payload) { host.warn('HD 高清参数不合法，请调整后重试'); return null; }
  return { projectId, nodeId, payload, identity: { ...identity } };
}
export function captureFrameInterpolation(host: PanelToolHost, nodeId: string, fps: FrameInterpolationFps): FrameInterpolationSubmission | null {
  const projectId = host.getProjectId();
  if (!projectId) { host.warn('未选中项目，无法发起插帧'); return null; }
  const identity = host.getNode(nodeId)?.data.frameInterpolation as FrameInterpolationIdentity | undefined;
  if (!identity?.sourceAssetId) { host.warn('源素材身份缺失，无法发起插帧'); return null; }
  const payload = buildFrameInterpolationInput(String(identity.sourceAssetId), nodeId, fps);
  if (!payload) { host.warn('插帧参数不合法，请调整后重试'); return null; }
  if (host.isFrameInFlight(nodeId)) return null;
  return { projectId, nodeId, payload, identity: { ...identity } };
}

export function createVideoEnhanceSession(getHost: () => PanelToolHost): ToolSessionDefinition<VideoEnhanceState, string, VideoEnhanceSubmission, VideoEnhanceResolution> {
  return {
    kind: 'videoEnhance', panel: 'preserve',
    initialize(nodeId, previous) {
      if (!getHost().canOpen(nodeId)) return null;
      if (previous?.nodeId === nodeId) return previous;
      const identity = getHost().getNode(nodeId)?.data.videoEnhance as VideoEnhanceIdentity | undefined;
      return { nodeId, seed: { ts: Date.now(), initialResolution: restoreVideoEnhanceResolution(identity?.lastParams) } };
    },
    opened(state) { getHost().activate(state.nodeId, true); return state; },
    target: (state) => state.nodeId,
    capture: (state, resolution) => resolution ? captureVideoEnhance(getHost(), state.nodeId, resolution) : null,
    async submit(input, context) { await getHost().startVideo(input); context.close(); },
    /** 提交锁的宿主在途判定：选中隐藏再选回时运行时以其重算上锁（显式关闭重开即新会话，允许重发）。 */
    inFlight: (state) => getHost().isVideoEnhanceInFlight(state.nodeId),
    onError(error) {
      if (isApiError(error) && error.status === 401) return;
      // 静默传输只把 HTTP 提示归属移到有效会话；保留原 HD 两路反馈。
      if (isApiError(error)) getHost().httpError(error.message);
      getHost().error(isApiError(error) ? error.message : 'HD 高清任务创建失败，请重试');
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
      if (isApiError(error) && error.status === 401) return;
      getHost().httpError(isApiError(error) ? error.message : '创建任务失败');
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
      if (isApiError(error) && error.status === 401) return;
      getHost().error(isApiError(error) || error instanceof FrameInterpolationSaveError ? error.message : '插帧任务创建失败，请重试');
    },
    reconcile(state) {
      const host = getHost();
      if (!host.isValidTarget(state.nodeId, 'frameInterpolation')) return null;
      const inFlight = host.isFrameInFlight(state.nodeId);
      return inFlight === state.inFlight ? state : { ...state, inFlight };
    },
  };
}
