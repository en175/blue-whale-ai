import {
  VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS,
  VIDEO_FRAME_INTERPOLATION_FPS_VALUES,
  VIDEO_FRAME_INTERPOLATION_INPUT_KEYS,
  videoFrameInterpolationInputSchema,
  type VideoFrameInterpolationFps,
  type VideoFrameInterpolationInput,
} from '@lib/contracts/video-frame-interpolation';
import { readJobFailText } from '@/custom/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { VIDEO_ENHANCE_MISSING_ASSET_REASON } from './videoEnhance';

export const FRAME_INTERPOLATION_EDGE_ORIGIN = 'frame-interpolation';

export const FRAME_INTERPOLATION_ENTRY_HINT = '提升视频帧率，画面更流畅';

export const FRAME_INTERPOLATION_DRAFT_HINT = '配置参数生成插帧视频';

export const FRAME_INTERPOLATION_SEND_HINT = '智能补帧，最高可至 120fps';

export const FRAME_INTERPOLATION_FPS_VALUES = VIDEO_FRAME_INTERPOLATION_FPS_VALUES;

export type FrameInterpolationFps = VideoFrameInterpolationFps;

export const FRAME_INTERPOLATION_DEFAULT_FPS = VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS;

export function frameInterpolationFpsLabel(fps: FrameInterpolationFps): string {
  return `${fps}fps`;
}

export function frameInterpolationDisplayName(fps: FrameInterpolationFps): string {
  return `插帧 · ${fps}fps`;
}

export interface FrameInterpolationIdentity {
  sourceAssetId?: string;
  lastParams?: Record<string, unknown>;
  frozenParams?: Record<string, unknown>;
  recoveryBlocked?: boolean;
}

export interface FrameInterpolationGateSource {
  assetId?: string | number | null;
}

export function frameInterpolationGateReason(source: FrameInterpolationGateSource): string | null {
  if (source.assetId == null) return VIDEO_ENHANCE_MISSING_ASSET_REASON;
  return null;
}

const FRAME_INTERPOLATION_NODE_GAP = 60;

export function frameInterpolationDraftPosition(source: {
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
    x: Math.round(left + box.width + FRAME_INTERPOLATION_NODE_GAP),
    y: Math.round(top),
  };
}

export function restoreFrameInterpolationFps(
  lastParams: Record<string, unknown> | undefined,
): FrameInterpolationFps {
  const fps = lastParams?.fps;
  return (VIDEO_FRAME_INTERPOLATION_FPS_VALUES as readonly unknown[]).includes(fps)
    ? (fps as FrameInterpolationFps)
    : FRAME_INTERPOLATION_DEFAULT_FPS;
}

export function restoreFrameInterpolationRetryFps(
  identity: FrameInterpolationIdentity | undefined,
): FrameInterpolationFps {
  return restoreFrameInterpolationFps(identity?.frozenParams ?? identity?.lastParams);
}


export function buildFrameInterpolationInput(
  sourceAssetId: string,
  targetNodeId: string,
  fps: FrameInterpolationFps,
): VideoFrameInterpolationInput | null {
  const input = {
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.sourceAssetId]: sourceAssetId,
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]: targetNodeId,
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.fps]: fps,
  };
  return videoFrameInterpolationInputSchema.safeParse(input).success
    ? (input as VideoFrameInterpolationInput)
    : null;
}

const FRAME_INTERPOLATION_ENQUEUE_FAILED_TEXT = '任务入队失败，请重试';

const FRAME_INTERPOLATION_ENQUEUE_FAILED_CODES: readonly string[] = ['enqueue_failed', '1028'];

const FRAME_INTERPOLATION_ERROR_CODE_TEXT: Record<string, string> = {
  video_frame_interpolation_failed: '视频插帧失败，请重试',
  '1049': '视频插帧失败，请重试',
};

export function frameInterpolationErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  const code = error?.code != null ? String(error.code) : '';
  if (code !== '' && FRAME_INTERPOLATION_ENQUEUE_FAILED_CODES.includes(code)) {
    return FRAME_INTERPOLATION_ENQUEUE_FAILED_TEXT;
  }
  const text = readJobFailText(error);
  if (text) return text;
  if (code !== '' && FRAME_INTERPOLATION_ERROR_CODE_TEXT[code]) {
    return FRAME_INTERPOLATION_ERROR_CODE_TEXT[code];
  }
  return '视频插帧失败，请重试';
}
