import type { Node } from '@xyflow/react';
import { buildAudioTrimInput, defaultAudioTrimOutputFormat, type AudioTrimInput } from '@lib/contracts/audio-trim';
import { buildAudioSpeedInput, type AudioSpeedInput } from '@lib/contracts/audio-speed';
import type { AudioTrimFormat } from './audioTrim';
import type { AudioTrimSelection } from './audioTrimGeometry';
import { VOCAL_SPLIT_DEFAULT_FORMAT, VOCAL_SPLIT_DEFAULT_SESSION_SCENE, type VocalSplitFormat, type VocalSplitScene } from './vocalSplit';
import { apiErrorMessage, captureMediaSource, captureSourceAsset, cloneSourceNode, requireProjectId } from './toolSessionCapture';
import type { ToolSessionDefinition } from './toolSessionRuntime';

export interface AudioToolSubmission<Payload> {
  projectId: string;
  source: Node;
  payload: Payload;
}

export interface AudioToolSessionHost<Payload> {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  createTask(input: AudioToolSubmission<Payload>): Promise<{ job_id: string }>;
  handoff(input: AudioToolSubmission<Payload>, task: { job_id: string }): Promise<void>;
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
      const task = await host.createTask(input);
      context.close();
      await host.handoff(input, task);
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

export type AudioSpeedSessionHost = Omit<AudioToolSessionHost<AudioSpeedInput>, 'handoff'> & {
  handoff(input: AudioToolSubmission<AudioSpeedInput>, task: { job_id: string }, beforeApply: () => void): Promise<void>;
};

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
      const task = await host.createTask(input);
      // 宿主先核对结果项目归属：需要暂存时不触碰界面，实际落卡前才退当次编辑。
      await host.handoff(input, task, context.close);
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

/** IKJJR5：人声分离宿主接口（镜像场景切分 runTask 型）——发送即退会话，预建占位卡与
 *  创建/轮询/扇出统一归任务运行时；创建失败反馈由占位卡失败态承接（不再经会话 onError）。 */
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
      // 发送即退出（对齐场景切分）：exitForSubmission 保留本次失败反馈身份——
      // 创建失败提示不吞、后来会话或项目切换使其失效
      context.exitForSubmission();
      await host.runTask(input);
    },
    onError(error) {
      getHost().error(apiErrorMessage(error, '人声背景分离任务创建失败，请重试'));
    },
  };
}
