import type { Node } from '@xyflow/react';
import { apiErrorMessage, captureMediaSource } from '../../tool-runtime/toolSessionCapture';
import {
  AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT,
  AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON,
  type AudioVideoSplitFormat,
} from './audioVideoSplit';
import type { ToolSessionDefinition } from '../../tool-runtime/toolSessionRuntime';

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
  startTask(input: AudioVideoSplitSubmission): boolean;
  warn(message: string): void;
  error(message: string): void;
}

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
      const captured = captureMediaSource(getHost(), state.nodeId, AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON, '未选中项目，无法音视频分离');
      if (!captured) return null;
      return {
        projectId: captured.projectId,
        source: captured.source,
        payload: { source_asset_id: captured.sourceAssetId, output_format: state.format },
      };
    },
    async submit(input, context) {
      const host = getHost();
      context.close();
      if (!host.startTask(input)) {
        host.warn('音视频分离任务未发出，请重试');
      }
    },
    onError(error) {
      getHost().error(apiErrorMessage(error, '音视频分离任务创建失败，请重试'));
    },
  };
}
