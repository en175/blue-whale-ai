import type { Node } from '@xyflow/react';
import { apiErrorMessage, captureMediaSource } from './toolSessionCapture';
import { SCENE_SPLIT_DEFAULT_GRANULARITY, type SceneSplitGranularity } from './sceneSplit';
import type { ToolSessionDefinition } from './toolSessionRuntime';

export interface SceneSplitState {
  nodeId: string;
  granularity: SceneSplitGranularity;
}
export interface SceneSplitSubmission {
  projectId: string;
  source: Node;
  payload: { source_asset_id: string; target_node_id: string; granularity: SceneSplitGranularity };
}
export interface SceneSplitHost {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  newTargetId(): string;
  isSending(): boolean;
  runTask(input: SceneSplitSubmission): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}

/** 发送先退出，宿主再预建卡并发请求；任务在途锁与失败卡不归编辑会话清理。 */
export function createSceneSplitSession(getHost: () => SceneSplitHost): ToolSessionDefinition<SceneSplitState, string, SceneSplitSubmission> {
  return {
    kind: 'sceneSplit',
    initialize(nodeId) {
      return getHost().getSourceNode(nodeId)?.type === 'mediaNode'
        ? { nodeId, granularity: SCENE_SPLIT_DEFAULT_GRANULARITY } : null;
    },
    target: (state) => state.nodeId,
    capture(state) {
      const host = getHost();
      if (host.isSending()) return null;
      const captured = captureMediaSource(host, state.nodeId, '当前视频尚未关联资产，无法场景切分', '未选中项目，无法场景切分');
      if (!captured) return null;
      return {
        projectId: captured.projectId,
        source: captured.source,
        payload: { source_asset_id: captured.sourceAssetId, target_node_id: host.newTargetId(), granularity: state.granularity },
      };
    },
    async submit(input, context) {
      const host = getHost();
      context.exitForSubmission();
      await host.runTask(input);
    },
    onError(error) { getHost().error(apiErrorMessage(error, '场景切分任务创建失败，请重试')); },
  };
}
