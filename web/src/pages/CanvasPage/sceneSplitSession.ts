import type { Node } from '@xyflow/react';
import { isApiError } from '@/api/http';
import { readAssetId } from './mediaRefs';
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
      const node = host.getSourceNode(state.nodeId);
      const sourceAssetId = readAssetId(node?.data ?? {});
      if (!node || !sourceAssetId) { host.warn('当前视频尚未关联资产，无法场景切分'); return null; }
      const projectId = host.getProjectId();
      if (!projectId) { host.warn('未选中项目，无法场景切分'); return null; }
      return {
        projectId, source: { ...node, position: { ...node.position }, data: { ...node.data } },
        payload: { source_asset_id: String(sourceAssetId), target_node_id: host.newTargetId(), granularity: state.granularity },
      };
    },
    async submit(input, context) {
      const host = getHost();
      context.exitForSubmission();
      await host.runTask(input);
    },
    onError(error) { getHost().error(isApiError(error) ? error.message : '场景切分任务创建失败，请重试'); },
  };
}
