import type { Node } from '@xyflow/react';
import { isApiError } from '@/api/http';
import { readAssetId } from './mediaRefs';
import {
  IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT, buildImageCutoutRequest, imageCutoutSceneGateReason,
  type ImageCutoutRequest, type ImageCutoutScene,
} from './imageCutout';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { ZERO_EXPANDS, outpaintGateReason, expandRatiosOf, presetExpands, maxExpandPerSide, type ExpandSides, type OutpaintPresetKey } from './imageOutpaint';
import type { ImageOutpaintInput } from '@lib/contracts/image-outpaint';
import type { ToolSessionDefinition } from './toolSessionRuntime';

export interface CutoutState {
  nodeId: string;
  scene: ImageCutoutScene;
  needContour: boolean;
  contourSize: number;
  needCropBackground: boolean;
}
export interface CutoutSubmission {
  projectId: string;
  source: Node;
  payload: ImageCutoutRequest;
}
export interface CutoutHost {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  newTargetId(): string;
  createTask(input: CutoutSubmission): Promise<{ job_id: string }>;
  handoff(input: CutoutSubmission, task: { job_id: string }, skipSelect: boolean): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}

export function createCutoutSession(getHost: () => CutoutHost): ToolSessionDefinition<CutoutState, string, CutoutSubmission> {
  return {
    kind: 'cutout',
    initialize(nodeId) {
      if (getHost().getSourceNode(nodeId)?.type !== 'mediaNode') return null;
      return { nodeId, scene: 'general', needContour: false, contourSize: IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT, needCropBackground: false };
    },
    target: (state) => state.nodeId,
    capture(state) {
      const host = getHost();
      const node = host.getSourceNode(state.nodeId);
      const sourceAssetId = readAssetId(node?.data ?? {});
      if (!node || !sourceAssetId) { host.warn('源素材身份缺失，无法发起图片抠图'); return null; }
      const reason = imageCutoutSceneGateReason(node.data, state.scene);
      if (reason) { host.warn(reason); return null; }
      const projectId = host.getProjectId();
      if (!projectId) { host.warn('未选中项目，无法发起图片抠图'); return null; }
      return {
        projectId, source: { ...node, position: { ...node.position }, data: { ...node.data } },
        payload: buildImageCutoutRequest({ sourceAssetId, targetNodeId: host.newTargetId(), scene: state.scene, needContour: state.needContour, contourSize: state.contourSize, needCropBackground: state.needCropBackground }),
      };
    },
    async submit(input, context) {
      const host = getHost();
      const task = await host.createTask(input);
      const current = context.isCurrent();
      context.close();
      await host.handoff(input, task, !current);
    },
    onError(error) { getHost().error(isApiError(error) ? error.message : '创建抠图任务失败，请重试'); },
  };
}

export interface OutpaintState {
  nodeId: string;
  expands: ExpandSides;
}
export interface OutpaintFrozenInput {
  projectId: string;
  source: Node;
  sourceAssetId: string;
  ratios: ExpandSides;
}
export interface OutpaintTaskSubmission {
  projectId: string;
  source: Node;
  targetNodeId: string;
  payload: ImageOutpaintInput;
}
export interface OutpaintHost {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  clearPickState(): void;
  prepareTask(input: OutpaintFrozenInput): OutpaintTaskSubmission | null;
  startTask(input: OutpaintTaskSubmission): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}
function outpaintBox(node: Node) {
  return mediaContentBox({ mediaType: node.data.mediaType as 'image' | undefined, width: typeof node.data.width === 'number' ? node.data.width : undefined, height: typeof node.data.height === 'number' ? node.data.height : undefined });
}
export function applyOutpaintPreset(state: OutpaintState, node: Node, preset: OutpaintPresetKey): OutpaintState {
  const box = outpaintBox(node);
  const expands = presetExpands(box, preset, maxExpandPerSide(box));
  return expands ? { ...state, expands } : state;
}

export function createOutpaintSession(getHost: () => OutpaintHost): ToolSessionDefinition<OutpaintState, string, OutpaintTaskSubmission> {
  return {
    kind: 'outpaint',
    initialize(nodeId) {
      const host = getHost();
      const node = host.getSourceNode(nodeId);
      if (!node || node.type !== 'mediaNode') return null;
      const reason = outpaintGateReason(typeof node.data.width === 'number' ? node.data.width : undefined, typeof node.data.height === 'number' ? node.data.height : undefined, typeof node.data.size === 'number' ? node.data.size : undefined);
      if (reason) { host.warn(reason); return null; }
      // 保留该工具既有顺序：门槛通过后先结束素材选取，再交协调器退出其他编辑会话。
      host.clearPickState();
      return { nodeId, expands: ZERO_EXPANDS };
    },
    target: (state) => state.nodeId,
    capture(state) {
      if (state.expands.top <= 0 && state.expands.right <= 0 && state.expands.bottom <= 0 && state.expands.left <= 0) return null;
      const host = getHost();
      const node = host.getSourceNode(state.nodeId);
      const sourceAssetId = readAssetId(node?.data ?? {});
      if (!node || !sourceAssetId) { host.warn('源素材身份缺失，无法发起扩图'); return null; }
      const projectId = host.getProjectId();
      if (!projectId) { host.warn('未选中项目，无法发起扩图'); return null; }
      return host.prepareTask({ projectId, source: { ...node, position: { ...node.position }, data: { ...node.data } }, sourceAssetId: String(sourceAssetId), ratios: expandRatiosOf(state.expands, outpaintBox(node)) });
    },
    async submit(input, context) {
      const pending = getHost().startTask(input);
      context.exitForSubmission();
      await pending;
    },
    onError(error) {
      if (isApiError(error) && error.status === 401) return;
      getHost().error(isApiError(error) ? error.message : '创建任务失败');
    },
  };
}
