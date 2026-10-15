export type ModelType = 'image' | 'video' | 'text' | 'audio';

export const TYPE_TABS: { key: ModelType; label: string }[] = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'text', label: '文生文' },
  { key: 'audio', label: '音频' },
];

export const FEATURE_BOOL_LABELS: Record<string, { label: string; types?: ModelType[] }> = {
  reference_image: { label: '参考图 reference_image', types: ['image', 'video'] },
  watermark: { label: '水印 watermark', types: ['image', 'video'] },
  stream: { label: '流式输出 stream', types: ['image'] },
  sequential_image_generation: { label: '顺序生成 sequential_image_generation', types: ['image'] },
  first_frame: { label: '首帧 first_frame', types: ['video'] },
  last_frame: { label: '尾帧 last_frame', types: ['video'] },
  first_last_frame: { label: '首尾帧 first_last_frame', types: ['video'] },
  audio: { label: '音频 audio', types: ['video'] },
  video_reference: { label: '视频素材参考 video_reference', types: ['video'] },
  audio_reference: { label: '音频素材参考 audio_reference', types: ['video'] },
  tools: { label: '工具调用 tools' },
  omni_reference_task_type: { label: '显式任务类型 omni_reference_task_type', types: ['video'] },
};

export const FEATURE_NUMBER_LABELS: Record<
  string,
  { label: string; types?: ModelType[]; placeholder: string }
> = {
  quantity_max: { label: '单次生成数量 quantity_max', types: ['image'], placeholder: '如 1' },
  max_prompt_length: {
    label: '提示词上限 max_prompt_length',
    types: ['image', 'video', 'text'],
    placeholder: '如 32000',
  },
  video_reference_max: { label: '视频参考上限 video_reference_max', types: ['video'], placeholder: '如 3' },
  audio_reference_max: { label: '音频参考上限 audio_reference_max', types: ['audio', 'video'], placeholder: '如 3' },
  image_reference_max: { label: '图片参考上限 image_reference_max', types: ['image', 'video', 'audio'], placeholder: '如 10' },
  max_reference_duration_sec: { label: '参考素材总时长上限秒 max_reference_duration_sec', types: ['video', 'audio'], placeholder: '如 15（留空 = 不限）' },
};

export const FEATURE_STRING_LABELS: Record<
  string,
  { label: string; types?: ModelType[]; placeholder: string }
> = {
  i2i_model_name: {
    label: '图生图上游模型名 i2i_model_name',
    types: ['image'],
    placeholder: '如 gpt-image-2-edit（留空 = 不分流）',
  },
};
