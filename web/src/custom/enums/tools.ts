import type { ImageEnhanceMode, ImageEnhanceVersionTier } from '@lib/contracts/image-enhance';
import { VOCAL_SPLIT_SCENES, type VocalSplitScene, type VocalSplitTrackType } from '@lib/contracts/vocal-split';
import { type VideoEnhanceResolution } from '@lib/contracts/video-enhance';
import type { VideoSceneSplitGranularity } from '@lib/contracts/video-scene-split';
import {
  type VideoMattingBackgroundColor,
  type VideoMattingFormat,
  type VideoMattingMode,
} from '@lib/contracts/video-matting';
import type { VideoMode } from '@/custom/utils/video-modes';
import type { AudioVideoMuxSync } from './canvas';

export const VIDEO_MODE_LABEL: Record<VideoMode, string> = {
  text2video: '文生视频',
  omni: '全能参考',
  image_reference: '图片参考',
  first_frame: '图生视频',
  first_last_frame: '首尾帧',
  edit: '视频编辑',
  extend: '视频延长',
};

export const SMART_MATTING_FORMAT_LABELS: Record<VideoMattingFormat, string> = {
  WEBM: 'WEBM 透明',
  MP4: 'MP4 纯色',
};

export const SMART_MATTING_BACKGROUND_COLOR_LABELS: Record<VideoMattingBackgroundColor, string> = {
  white: '白色',
  black: '黑色',
  green: '绿色',
};

export const SMART_MATTING_MODE_LABELS: Record<VideoMattingMode, string> = {
  portrait: '人像抠像',
  greenscreen: '绿幕抠像',
};

export const SCENE_SPLIT_GRANULARITY_LABELS: Record<VideoSceneSplitGranularity, string> = {
  fine: '细',
  standard: '标准',
  coarse: '粗',
};

export const VOCAL_SPLIT_SCENE_OPTIONS: readonly VocalSplitScene[] = VOCAL_SPLIT_SCENES;

export const VOCAL_SPLIT_TRACK_LABELS: Record<VocalSplitTrackType, string> = {
  voice: '人声',
  background: '背景音',
  music: '音乐',
  sfx: '音效',
};

export const IMAGE_ENHANCE_TIER_LABELS: Record<ImageEnhanceVersionTier, string> = {
  lite: 'Lite',
  pro: 'Pro',
  max: 'Max',
};

export const IMAGE_ENHANCE_MODE_LABELS: Record<ImageEnhanceMode, string> = {
  generative_first: '生成度优先',
  fidelity_first: '保真度优先',
};

export const VIDEO_ENHANCE_RESOLUTION_LABELS: Record<VideoEnhanceResolution, string> = {
  '1080p': '1080P',
  '2k': '2K',
  '4k': '4K',
};

export const AUDIO_VIDEO_MUX_RESERVE_OPTIONS: ReadonlyArray<{ value: boolean; label: string }> = [
  { value: true, label: '保留原声' },
  { value: false, label: '替换原声' },
];

export const AUDIO_VIDEO_MUX_SYNC_OPTIONS: ReadonlyArray<{ value: AudioVideoMuxSync; label: string }> = [
  { value: 'none', label: '保持原长' },
  { value: 'video', label: '裁到视频长' },
  { value: 'audio', label: '裁到音频长' },
];
