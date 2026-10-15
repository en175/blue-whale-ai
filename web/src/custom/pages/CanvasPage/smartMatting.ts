
import {
  VIDEO_MATTING_BACKGROUND_COLORS,
  VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR,
  VIDEO_MATTING_DEFAULT_FORMAT,
  VIDEO_MATTING_FORMATS,
  VIDEO_MATTING_MAX_DURATION_MS,
  VIDEO_MATTING_MODES,
  type VideoMattingBackgroundColor,
  type VideoMattingFormat,
  type VideoMattingMode,
} from '@lib/contracts/video-matting';
import { readJobFailText } from '@/custom/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

export const SMART_MATTING_ENTRY_HINT = '识别人物或绿幕主体并移除背景，输出透明/纯色视频';

export const SMART_MATTING_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法智能抠像';

export const SMART_MATTING_MAX_DURATION_SECONDS = VIDEO_MATTING_MAX_DURATION_MS / 1000;

export const SMART_MATTING_OVER_DURATION_REASON = '视频超过 10 分钟，暂不支持智能抠像';

export interface SmartMattingGateSource {
  assetId?: string | number | null;
  duration?: number;
}

export function smartMattingGateReason(source: SmartMattingGateSource): string | null {
  if (source.assetId == null) return SMART_MATTING_MISSING_ASSET_REASON;
  if (
    typeof source.duration === 'number'
    && source.duration > SMART_MATTING_MAX_DURATION_SECONDS
  ) {
    return SMART_MATTING_OVER_DURATION_REASON;
  }
  return null;
}


export const SMART_MATTING_MODES = VIDEO_MATTING_MODES;

export type SmartMattingMode = VideoMattingMode;

export const SMART_MATTING_PORTRAIT_HINT = '任意视频，自动识别人物主体';

export const SMART_MATTING_GREENSCREEN_HINT = '绿幕/纯色背景素材，主体可为人、物品、动物';


export const SMART_MATTING_FORMATS = VIDEO_MATTING_FORMATS;

export type SmartMattingFormat = VideoMattingFormat;

export const SMART_MATTING_DEFAULT_FORMAT: SmartMattingFormat = VIDEO_MATTING_DEFAULT_FORMAT;

export const SMART_MATTING_BACKGROUND_COLORS = VIDEO_MATTING_BACKGROUND_COLORS;

export type SmartMattingBackgroundColor = VideoMattingBackgroundColor;

export const SMART_MATTING_DEFAULT_BACKGROUND_COLOR: SmartMattingBackgroundColor =
  VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR;

import { SMART_MATTING_MODE_LABELS } from '@/custom/enums';

export const SMART_MATTING_EDGE_ORIGIN = 'smart-matting';

export const SMART_MATTING_NODE_GAP = 60;

export function smartMattingDisplayName(mode: SmartMattingMode): string {
  return SMART_MATTING_MODE_LABELS[mode];
}

export interface SmartMattingParams {
  source_asset_id: string;
  target_node_id: string;
  mode: SmartMattingMode;
  format: SmartMattingFormat;
  background_color?: SmartMattingBackgroundColor;
}

export function buildSmartMattingInput(input: {
  sourceAssetId: string;
  targetNodeId: string;
  mode: SmartMattingMode;
  format: SmartMattingFormat;
  backgroundColor: SmartMattingBackgroundColor;
}): SmartMattingParams {
  return input.format === 'MP4'
    ? {
        source_asset_id: input.sourceAssetId,
        target_node_id: input.targetNodeId,
        mode: input.mode,
        format: input.format,
        background_color: input.backgroundColor,
      }
    : {
        source_asset_id: input.sourceAssetId,
        target_node_id: input.targetNodeId,
        mode: input.mode,
        format: input.format,
      };
}

export interface SmartMattingIdentity {
  sourceAssetId: string;
  lastInput: SmartMattingParams;
}

export function buildSmartMattingPlaceholderNode(input: {
  nodeId: string;
  mode: SmartMattingMode;
  sourceAssetId: string;
  lastInput: SmartMattingParams;
  source?: { position?: { x?: number; y?: number }; data?: Record<string, unknown> } | null;
}): {
  id: string;
  type: 'mediaNode';
  position: { x: number; y: number };
  data: Record<string, unknown>;
} {
  const x = Number(input.source?.position?.x ?? 0);
  const y = Number(input.source?.position?.y ?? 0);
  const data = input.source?.data ?? {};
  const box = mediaContentBox({
    mediaType: data.mediaType as 'image' | 'video' | 'audio' | undefined,
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    ratio: typeof data.targetRatio === 'string' ? data.targetRatio : undefined,
  });
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    id: input.nodeId,
    type: 'mediaNode',
    position: {
      x: Math.round(left + box.width + SMART_MATTING_NODE_GAP),
      y: Math.round(top),
    },
    data: {
      src: '',
      fileName: smartMattingDisplayName(input.mode),
      mediaType: 'video',
      genStatus: 'generating',
      progress: 0,
      toolMode: 'select',
      smartMatting: {
        sourceAssetId: input.sourceAssetId,
        lastInput: input.lastInput,
      } satisfies SmartMattingIdentity,
    },
  };
}

export function smartMattingErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  return readJobFailText(error) || '智能抠像失败，请重试';
}
