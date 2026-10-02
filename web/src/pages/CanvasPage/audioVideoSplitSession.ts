import type { Node } from '@xyflow/react';
import { isApiError } from '@/api/http';
import { readAssetId } from './mediaRefs';
import {
  AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT,
  AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON,
  type AudioVideoSplitFormat,
} from './audioVideoSplit';
import type { ToolSessionDefinition } from './toolSessionRuntime';

export interface AudioVideoSplitState {
  nodeId: string;
  format: AudioVideoSplitFormat;
}

export interface AudioVideoSplitSubmission {
  projectId: string;
  source: Node;
  payload: { source_asset_id: string; output_format: AudioVideoSplitFormat };
}

export interface AudioVideoSplitHost {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  createTask(input: AudioVideoSplitSubmission): Promise<{ job_id: string }>;
  handoff(input: AudioVideoSplitSubmission, task: { job_id: string }): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}

/** 工具差异只声明初始化、冻结输入和受理后的退出顺序；任务建卡/轮询/落盘留在宿主。 */
export function createAudioVideoSplitSession(
  getHost: () => AudioVideoSplitHost,
): ToolSessionDefinition<AudioVideoSplitState, string, AudioVideoSplitSubmission> {
  return {
    kind: 'audioVideoSplit',
    initialize(nodeId) {
      const node = getHost().getSourceNode(nodeId);
      return node?.type === 'mediaNode' ? { nodeId, format: AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT } : null;
    },
    target: (state) => state.nodeId,
    capture(state) {
      const host = getHost();
      const node = host.getSourceNode(state.nodeId);
      const sourceAssetId = readAssetId(node?.data ?? {});
      if (!node || !sourceAssetId) {
        host.warn(AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON);
        return null;
      }
      const projectId = host.getProjectId();
      if (!projectId) {
        host.warn('未选中项目，无法音视频分离');
        return null;
      }
      return {
        projectId,
        source: { ...node, position: { ...node.position }, data: { ...node.data } },
        payload: { source_asset_id: String(sourceAssetId), output_format: state.format },
      };
    },
    async submit(input, context) {
      const host = getHost();
      const task = await host.createTask(input);
      context.close();
      await host.handoff(input, task);
    },
    onError(error) {
      getHost().error(isApiError(error) ? error.message : '音视频分离任务创建失败，请重试');
    },
  };
}
