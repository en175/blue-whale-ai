
export const TASK_TYPE_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  media_extract: '音频提取',
  image_enhance: '高清放大',
  image_erase: '图片擦除',
  image_outpaint: '智能扩图',
  image_cutout: '图片抠图',
  video_subtitle_erase: '视频去字幕',
  audio_trim: '音频截取',
  audio_mix: '音频混合',
  video_frame_interpolation: '视频插帧',
  video_matting: '视频抠像',
};

export function taskTypeLabel(type: string): string {
  return TASK_TYPE_LABELS[type] ?? type;
}

export const TASK_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  ...Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];
