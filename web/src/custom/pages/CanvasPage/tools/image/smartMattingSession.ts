import type { Node } from '@xyflow/react';
import { apiErrorMessage, captureMediaSource, isSilentAuthError } from '../../tool-runtime/toolSessionCapture';
import {
  SMART_MATTING_DEFAULT_BACKGROUND_COLOR, SMART_MATTING_DEFAULT_FORMAT, buildSmartMattingInput,
  type SmartMattingMode, type SmartMattingFormat, type SmartMattingBackgroundColor, type SmartMattingParams,
} from './smartMatting';
import type { ToolSessionDefinition } from '../../tool-runtime/toolSessionRuntime';

export interface SmartMattingState {
  nodeId: string;
  mode: SmartMattingMode;
  format: SmartMattingFormat;
  backgroundColor: SmartMattingBackgroundColor;
}
export interface SmartMattingSubmission {
  projectId: string;
  source: Node;
  payload: SmartMattingParams;
}
export interface SmartMattingHost {
  getProjectId(): string | null;
  getSourceNode(nodeId: string): Node | undefined;
  newTargetId(): string;
  isSending(): boolean;
  runTask(input: SmartMattingSubmission): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}

export function createSmartMattingSession(
  getHost: () => SmartMattingHost,
): ToolSessionDefinition<SmartMattingState, { nodeId: string; mode: SmartMattingMode }, SmartMattingSubmission> {
  return {
    kind: 'smartMatting',
    initialize(entry) {
      if (getHost().getSourceNode(entry.nodeId)?.type !== 'mediaNode') return null;
      return { ...entry, format: SMART_MATTING_DEFAULT_FORMAT, backgroundColor: SMART_MATTING_DEFAULT_BACKGROUND_COLOR };
    },
    target: (state) => state.nodeId,
    capture(state) {
      const host = getHost();
      if (host.isSending()) return null;
      const captured = captureMediaSource(host, state.nodeId, '当前视频尚未关联资产，无法智能抠像', '未选中项目，无法智能抠像');
      if (!captured) return null;
      return {
        projectId: captured.projectId, source: captured.source,
        payload: buildSmartMattingInput({ sourceAssetId: captured.sourceAssetId, targetNodeId: host.newTargetId(), mode: state.mode, format: state.format, backgroundColor: state.backgroundColor }),
      };
    },
    async submit(input, context) {
      const host = getHost();
      context.exitForSubmission();
      await host.runTask(input);
    },
    onError(error) {
      if (isSilentAuthError(error)) return;
      getHost().error(apiErrorMessage(error, '智能抠像任务创建失败，请重试'));
    },
  };
}
