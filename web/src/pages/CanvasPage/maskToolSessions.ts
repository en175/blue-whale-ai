import { apiErrorMessage, captureMediaSource } from './toolSessionCapture';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import type { Node } from '@xyflow/react';
import type { ImageEraseInput } from '@lib/contracts/image-erase';
import { EMPTY_MASK_EDIT, applyMaskOp, type MaskEditState, type MaskOp, type MaskPoint, type MaskCoordinateSpace } from './eraseMask';
import { buildVideoSubtitleEraseInput, type VideoSubtitleEraseInput, type VideoSubtitleEraseMode } from './videoSubtitleErase';
import { EMPTY_SUBTITLE_BOX_EDIT, applySubtitleBox, canAddSubtitleBox, type SubtitleBoxEditState, type SubtitleBoxOp, type SubtitleBoxPoint } from './subtitleEraseBoxes';
import { maskHasPaintArea } from './imageErase';
import type { EraseTool } from './components/ImageEraseDialog';
import type { ToolSessionDefinition } from './toolSessionRuntime';

export interface ImageEraseState {
  nodeId: string;
  tool: EraseTool;
  brushRadius: number;
  mask: MaskEditState;
  liveOp: MaskOp | null;
  points: MaskPoint[];
}
export interface ImageEraseTaskSubmission {
  projectId: string;
  source: Node;
  payload: ImageEraseInput;
}
interface ImageEraseSendInput {
  projectId: string;
  source: Node;
  sourceAssetId: string;
  targetNodeId: string;
  mask: { ops: readonly MaskOp[]; space: MaskCoordinateSpace } | null;
}
class EraseMaskError extends Error {}

export interface ImageEraseHost {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  newTargetId(): string;
  encodeMask(ops: readonly MaskOp[], space: MaskCoordinateSpace): Promise<File | null>;
  uploadMask(file: File, projectId: string): Promise<{ asset_id: string }>;
  createTask(input: ImageEraseTaskSubmission): Promise<{ job_id: string }>;
  handoff(input: ImageEraseTaskSubmission, task: { job_id: string }, skipSelect: boolean): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}

export function beginEraseStroke(state: ImageEraseState, point: MaskPoint): ImageEraseState {
  if (state.tool === 'rect') return { ...state, liveOp: { kind: 'rect', erase: false, from: point, to: point } };
  return { ...state, points: [point], liveOp: { kind: 'stroke', erase: state.tool === 'eraser', points: [point], radius: state.brushRadius } };
}
export function moveEraseStroke(state: ImageEraseState, point: MaskPoint): ImageEraseState {
  const live = state.liveOp;
  if (!live) return state;
  if (live.kind === 'rect') return { ...state, liveOp: { ...live, to: point } };
  const points = [...state.points, point];
  return { ...state, points, liveOp: { ...live, points } };
}
export function endEraseStroke(state: ImageEraseState): ImageEraseState {
  return { ...state, mask: state.liveOp ? applyMaskOp(state.mask, state.liveOp) : state.mask, liveOp: null, points: [] };
}

export function createImageEraseSession(
  getHost: () => ImageEraseHost,
): ToolSessionDefinition<ImageEraseState, string, ImageEraseSendInput, 'mask' | 'text'> {
  let brushRadius = 20;
  return {
    kind: 'erase',
    initialize(nodeId, previous) {
      if (getHost().getSourceNode(nodeId)?.type !== 'mediaNode') return null;
      return { nodeId, tool: 'brush', brushRadius: previous?.brushRadius ?? brushRadius, mask: EMPTY_MASK_EDIT, liveOp: null, points: [] };
    },
    cleanup(state) { brushRadius = state.brushRadius; },
    target: (state) => state.nodeId,
    capture(state, request) {
      if (!request) return null;
      const host = getHost();
      const captured = captureMediaSource(host, state.nodeId, '源素材身份缺失，无法发起图片擦除', '未选中项目，无法发起图片擦除');
      if (!captured) return null;
      let mask: ImageEraseSendInput['mask'] = null;
      if (request === 'mask') {
        const { width, height } = captured.source.data;
        if (typeof width !== 'number' || typeof height !== 'number') return null;
        const display = mediaContentBox({ mediaType: 'image', width, height });
        if (!maskHasPaintArea(state.mask.ops, display.width, display.height)) return null;
        mask = { ops: structuredClone(state.mask.ops), space: { displayWidth: display.width, displayHeight: display.height, naturalWidth: width, naturalHeight: height } };
      }
      return { projectId: captured.projectId, source: captured.source, sourceAssetId: captured.sourceAssetId, targetNodeId: host.newTargetId(), mask };
    },
    async submit(input, context) {
      const host = getHost();
      let payload: ImageEraseInput;
      if (input.mask) {
        const file = await host.encodeMask(input.mask.ops, input.mask.space);
        if (!file) throw new EraseMaskError('遮罩生成失败，请重试');
        let uploaded: { asset_id: string };
        try { uploaded = await host.uploadMask(file, input.projectId); }
        catch (error: unknown) { throw new EraseMaskError(apiErrorMessage(error, '遮罩上传失败，请重试')); }
        payload = { source_asset_id: input.sourceAssetId, target_node_id: input.targetNodeId, erase_scene: 'selected_area_erase', mask_asset_id: uploaded.asset_id };
      } else {
        payload = { source_asset_id: input.sourceAssetId, target_node_id: input.targetNodeId, erase_scene: 'full_screen_text_erase' };
      }
      const submission = { projectId: input.projectId, source: input.source, payload };
      const task = await host.createTask(submission);
      const current = context.isCurrent();
      context.close();
      await host.handoff(submission, task, !current);
    },
    onError(error) {
      getHost().error(apiErrorMessage(error, '创建擦除任务失败，请重试', EraseMaskError));
    },
  };
}

export interface SubtitleEraseState {
  nodeId: string;
  mode: VideoSubtitleEraseMode;
  boxes: SubtitleBoxEditState;
  liveBox: SubtitleBoxOp | null;
}
export interface SubtitleEraseTaskSubmission {
  projectId: string;
  source: Node;
  payload: VideoSubtitleEraseInput;
}
export interface SubtitleEraseHost {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  newTargetId(): string;
  createTask(input: SubtitleEraseTaskSubmission): Promise<{ job_id: string }>;
  handoff(input: SubtitleEraseTaskSubmission, task: { job_id: string }, skipSelect: boolean): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}
export function beginSubtitleBox(state: SubtitleEraseState, point: SubtitleBoxPoint, onLimit: () => void): SubtitleEraseState {
  if (!canAddSubtitleBox(state.boxes)) { onLimit(); return state; }
  return { ...state, liveBox: { kind: 'box', from: point, to: point } };
}
export function moveSubtitleBox(state: SubtitleEraseState, point: SubtitleBoxPoint): SubtitleEraseState {
  return state.liveBox ? { ...state, liveBox: { ...state.liveBox, to: point } } : state;
}
export function endSubtitleBox(state: SubtitleEraseState): SubtitleEraseState {
  return { ...state, boxes: state.liveBox ? applySubtitleBox(state.boxes, state.liveBox) : state.boxes, liveBox: null };
}

export function createSubtitleEraseSession(
  getHost: () => SubtitleEraseHost,
): ToolSessionDefinition<SubtitleEraseState, { nodeId: string; mode: VideoSubtitleEraseMode }, SubtitleEraseTaskSubmission> {
  return {
    kind: 'subtitleErase',
    initialize(entry) {
      if (getHost().getSourceNode(entry.nodeId)?.type !== 'mediaNode') return null;
      return { ...entry, boxes: EMPTY_SUBTITLE_BOX_EDIT, liveBox: null };
    },
    target: (state) => state.nodeId,
    capture(state) {
      if (state.mode === 'box' && state.boxes.boxes.length === 0) return null;
      const captured = captureMediaSource(getHost(), state.nodeId, '源素材身份缺失，无法发起视频去字幕', '未选中项目，无法发起视频去字幕');
      if (!captured) return null;
      const display = mediaContentBox({ mediaType: 'video', width: typeof captured.source.data.width === 'number' ? captured.source.data.width : undefined, height: typeof captured.source.data.height === 'number' ? captured.source.data.height : undefined });
      return {
        projectId: captured.projectId, source: captured.source,
        payload: buildVideoSubtitleEraseInput({ sourceAssetId: captured.sourceAssetId, targetNodeId: getHost().newTargetId(), boxes: state.boxes.boxes, displayWidth: display.width, displayHeight: display.height }),
      };
    },
    async submit(input, context) {
      const host = getHost();
      const task = await host.createTask(input);
      const current = context.isCurrent();
      context.close();
      await host.handoff(input, task, !current);
    },
    onError(error) { getHost().error(apiErrorMessage(error, '创建去字幕任务失败，请重试')); },
  };
}
