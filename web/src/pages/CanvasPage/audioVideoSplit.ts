
import {
  MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT,
  MEDIA_EXTRACT_OUTPUT_FORMATS,
  type MediaExtractOutputFormat,
} from '@lib/contracts/media-extract';


export const AUDIO_VIDEO_SPLIT_FORMATS = MEDIA_EXTRACT_OUTPUT_FORMATS;

export type AudioVideoSplitFormat = MediaExtractOutputFormat;

export const AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT: AudioVideoSplitFormat = MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT;

export function isAudioVideoSplitFormat(value: unknown): value is AudioVideoSplitFormat {
  return (AUDIO_VIDEO_SPLIT_FORMATS as readonly unknown[]).includes(value);
}


export const AUDIO_VIDEO_SPLIT_ENTRY_HINT = '将视频完整音轨分离为音频卡片（仅音频，不产出去音轨的视频）';

export const AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法音视频分离';

export interface AudioVideoSplitGateSource {
  assetId?: string | number | null;
}

export function audioVideoSplitGateReason(source: AudioVideoSplitGateSource): string | null {
  if (source.assetId == null) return AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON;
  return null;
}
