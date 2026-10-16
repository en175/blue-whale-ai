import type { Node } from '@xyflow/react';
import { buildAudioTrimInput, defaultAudioTrimOutputFormat, type AudioTrimInput } from '@lib/contracts/audio-trim';
import { buildAudioSpeedInput, type AudioSpeedInput } from '@lib/contracts/audio-speed';
import type { AudioTrimFormat } from './audioTrim';
import type { AudioTrimSelection } from './audioTrimGeometry';
import { VOCAL_SPLIT_DEFAULT_FORMAT, VOCAL_SPLIT_DEFAULT_SESSION_SCENE, type VocalSplitFormat, type VocalSplitScene } from './vocalSplit';
import { apiErrorMessage, captureMediaSource, captureSourceAsset, cloneSourceNode, requireProjectId } from '../../tool-runtime/toolSessionCapture';
import type { ToolSessionDefinition } from '../../tool-runtime/toolSessionRuntime';

export interface AudioToolSubmission<Payload> {
  projectId: string;
  source: Node;
  payload: Payload;
}

export interface AudioToolSessionHost<Payload> {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  startTask(input: AudioToolSubmission<Payload>): boolean;
  warn(message: string): void;
  error(message: string): void;
}

export interface AudioTrimState {
  nodeId: string;
  selection: AudioTrimSelection;
  format: AudioTrimFormat;
}

export function createAudioTrimSession(
  getHost: () => AudioToolSessionHost<AudioTrimInput>,
): ToolSessionDefinition<AudioTrimState, string, AudioToolSubmission<AudioTrimInput>> {
  return {
    kind: 'audioTrim',
    initialize(nodeId) {
      const node = getHost().getSourceNode(nodeId);
      if (!node || node.type !== 'mediaNode') return null;
      return {
        nodeId,
        selection: { start: 0, end: typeof node.data.duration === 'number' ? node.data.duration : 0 },
        format: defaultAudioTrimOutputFormat(typeof node.data.fileName === 'string' ? node.data.fileName : ''),
      };
    },
    target: (state) => state.nodeId,
    capture(state) {
      const host = getHost();
      const asset = captureSourceAsset(host, state.nodeId, '当前音频尚未关联资产，无法截取');
      if (!asset) return null;
      const sourceDuration = typeof asset.node.data.duration === 'number' ? asset.node.data.duration : 0;
      if (!(sourceDuration > 0)) {
        host.warn('音频时长缺失，无法截取');
        return null;
      }
      const projectId = requireProjectId(host, '未选中项目，无法截取');
      if (!projectId) return null;
      return {
        projectId,
        source: cloneSourceNode(asset.node),
        payload: buildAudioTrimInput({
          sourceAssetId: asset.sourceAssetId,
          timeRange: { ...state.selection, sourceDuration },
          outputFormat: state.format,
        }),
      };
    },
    async submit(input, context) {
      const host = getHost();
      context.close();
      if (!host.startTask(input)) {
        host.warn('音频截取任务未发出，请重试');
      }
    },
    onError(error) {
      getHost().error(apiErrorMessage(error, '音频截取任务创建失败，请重试'));
    },
  };
}

export interface AudioSpeedState {
  nodeId: string;
  speed: number;
}

export type AudioSpeedSessionHost = AudioToolSessionHost<AudioSpeedInput>;

export function createAudioSpeedSession(
  getHost: () => AudioSpeedSessionHost,
): ToolSessionDefinition<AudioSpeedState, string, AudioToolSubmission<AudioSpeedInput>> {
  return {
    kind: 'audioSpeed',
    initialize(nodeId) {
      const node = getHost().getSourceNode(nodeId);
      return node?.type === 'mediaNode' ? { nodeId, speed: 1 } : null;
    },
    target: (state) => state.nodeId,
    capture(state) {
      const host = getHost();
      const asset = captureSourceAsset(host, state.nodeId, '当前音频尚未关联资产，无法调速');
      if (!asset) return null;
      if (state.speed === 1) return null;
      const projectId = requireProjectId(host, '未选中项目，无法调速');
      if (!projectId) return null;
      return {
        projectId,
        source: cloneSourceNode(asset.node),
        payload: buildAudioSpeedInput({ sourceAssetId: asset.sourceAssetId, speed: state.speed }),
      };
    },
    async submit(input, context) {
      const host = getHost();
      context.close();
      if (!host.startTask(input)) {
        host.warn('音频调速任务未发出，请重试');
      }
    },
    onError(error) {
      getHost().error(apiErrorMessage(error, '音频调速任务创建失败，请重试'));
    },
  };
}

export interface VocalSplitState {
  nodeId: string;
  scene: VocalSplitScene;
  format: VocalSplitFormat;
}

export interface VocalSplitPayload {
  source_asset_id: string;
  scene: VocalSplitScene;
  output_format: VocalSplitFormat;
}

export interface VocalSplitSessionHost {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  runTask(input: AudioToolSubmission<VocalSplitPayload>): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}

export function createVocalSplitSession(
  getHost: () => VocalSplitSessionHost,
): ToolSessionDefinition<VocalSplitState, string, AudioToolSubmission<VocalSplitPayload>> {
  return {
    kind: 'vocalSplit',
    initialize(nodeId) {
      const node = getHost().getSourceNode(nodeId);
      return node?.type === 'mediaNode' ? { nodeId, scene: VOCAL_SPLIT_DEFAULT_SESSION_SCENE, format: VOCAL_SPLIT_DEFAULT_FORMAT } : null;
    },
    target: (state) => state.nodeId,
    capture(state) {
      const captured = captureMediaSource(getHost(), state.nodeId, '当前视频尚未关联资产，无法人声背景分离', '未选中项目，无法人声背景分离');
      if (!captured) return null;
      return {
        projectId: captured.projectId,
        source: captured.source,
        payload: { source_asset_id: captured.sourceAssetId, scene: state.scene, output_format: state.format },
      };
    },
    async submit(input, context) {
      const host = getHost();
      context.exitForSubmission();
      await host.runTask(input);
    },
    onError(error) {
      getHost().error(apiErrorMessage(error, '人声背景分离任务创建失败，请重试'));
    },
  };
}
