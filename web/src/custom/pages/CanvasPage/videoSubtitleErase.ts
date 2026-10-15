
import {
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
  type VideoSubtitleEraseInput,
} from '@lib/contracts/video-subtitle-erase';
import { subtitleBoxesToPayload, type SubtitleBoxOp } from './subtitleEraseBoxes';


export {
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
};
export type { VideoSubtitleEraseInput };

export type VideoSubtitleEraseMode = 'smart' | 'box';


export interface VideoSubtitleEraseGateSource {
  width?: number;
  height?: number;
  duration?: number;
}

export function videoSubtitleEraseGateReason(source: VideoSubtitleEraseGateSource): string | null {
  const { width, height, duration } = source;
  if (typeof width === 'number' && typeof height === 'number') {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (
      longSide > VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX
      || shortSide > VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX
    ) {
      return `视频长边超过 ${VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX} 或短边超过 ${VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX}（2K 上限），无法智能去字幕`;
    }
  }
  if (typeof duration === 'number' && duration * 1000 > VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS) {
    return '视频超过 10 分钟，暂支持 10 分钟以内的视频';
  }
  return null;
}


export interface VideoSubtitleEraseSendSource {
  sourceAssetId: string;
  targetNodeId: string;
  boxes: readonly SubtitleBoxOp[];
  displayWidth: number;
  displayHeight: number;
}

export function buildVideoSubtitleEraseInput(source: VideoSubtitleEraseSendSource): VideoSubtitleEraseInput {
  return {
    source_asset_id: source.sourceAssetId,
    target_node_id: source.targetNodeId,
    detect_mode: 'subtitle_smart',
    erase_boxes: subtitleBoxesToPayload(source.boxes, source.displayWidth, source.displayHeight),
  };
}

export interface VideoSubtitleEraseIdentity {
  sourceAssetId?: string;
  lastInput?: VideoSubtitleEraseInput;
}
