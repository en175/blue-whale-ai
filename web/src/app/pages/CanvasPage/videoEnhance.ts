import {
  VIDEO_ENHANCE_DEFAULT_RESOLUTION,
  VIDEO_ENHANCE_INPUT_KEYS,
  VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX,
  VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_RESOLUTIONS,
  videoEnhanceInputSchema,
  type VideoEnhanceInput,
  type VideoEnhanceResolution,
} from '@lib/contracts/video-enhance';
import { readJobFailText } from '@/app/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

export const VIDEO_ENHANCE_EDGE_ORIGIN = 'video-enhance';

const VIDEO_ENHANCE_NODE_GAP = 60;

export interface VideoEnhanceIdentity {
  sourceAssetId?: string;
  lastParams?: Record<string, unknown>;
}

export const VIDEO_ENHANCE_RESOLUTION_LABELS: Record<VideoEnhanceResolution, string> = {
  '1080p': '1080P',
  '2k': '2K',
  '4k': '4K',
};

export function videoEnhanceDraftPosition(source: {
  position?: { x?: number; y?: number };
  data?: Record<string, unknown>;
}): { x: number; y: number } {
  const x = Number(source.position?.x ?? 0);
  const y = Number(source.position?.y ?? 0);
  const data = source.data ?? {};
  const box = mediaContentBox({
    mediaType: data.mediaType as 'image' | 'video' | 'audio' | undefined,
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    ratio: typeof data.targetRatio === 'string' ? data.targetRatio : undefined,
  });
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    x: Math.round(left + box.width + VIDEO_ENHANCE_NODE_GAP),
    y: Math.round(top),
  };
}

export const VIDEO_ENHANCE_ENTRY_HINT = '提升视频清晰度，最高可至 4K';

export const VIDEO_ENHANCE_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法高清增强';


export interface VideoEnhanceGateSource {
  width?: number;
  height?: number;
  assetId?: string | number | null;
}

export function videoEnhanceGateReason(source: VideoEnhanceGateSource): string | null {
  if (source.assetId == null) return VIDEO_ENHANCE_MISSING_ASSET_REASON;
  const { width, height } = source;
  if (typeof width === 'number' && typeof height === 'number') {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (
      longSide > VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX
      || shortSide > VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX
    ) {
      return `视频长边超过 ${VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX} 或短边超过 ${VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX}（超出输入上限），无法高清增强`;
    }
    if (shortSide < VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX) {
      return `视频短边小于 ${VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX}（低于输入下限），无法高清增强`;
    }
  }
  return null;
}


export function restoreVideoEnhanceResolution(
  lastParams: Record<string, unknown> | undefined,
): VideoEnhanceResolution {
  const resolution = lastParams?.resolution;
  return (VIDEO_ENHANCE_RESOLUTIONS as readonly string[]).includes(resolution as string)
    ? (resolution as VideoEnhanceResolution)
    : VIDEO_ENHANCE_DEFAULT_RESOLUTION;
}


export function buildVideoEnhanceInput(
  sourceAssetId: string,
  targetNodeId: string,
  resolution: VideoEnhanceResolution,
): VideoEnhanceInput | null {
  const input = {
    [VIDEO_ENHANCE_INPUT_KEYS.sourceAssetId]: sourceAssetId,
    [VIDEO_ENHANCE_INPUT_KEYS.targetNodeId]: targetNodeId,
    [VIDEO_ENHANCE_INPUT_KEYS.resolution]: resolution,
  };
  return videoEnhanceInputSchema.safeParse(input).success ? (input as VideoEnhanceInput) : null;
}

const VIDEO_ENHANCE_ERROR_CODE_TEXT: Record<string, string> = {
  video_enhance_failed: '视频画质增强失败，请重试',
  '1045': '视频画质增强失败，请重试',
  enqueue_failed: '任务入队失败，请重试',
};

export function videoEnhanceErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  const text = readJobFailText(error);
  if (text) return text;
  if (error?.code != null && VIDEO_ENHANCE_ERROR_CODE_TEXT[String(error.code)]) {
    return VIDEO_ENHANCE_ERROR_CODE_TEXT[String(error.code)];
  }
  return '视频画质增强失败，请重试';
}
