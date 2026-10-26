export type GenerationJobType = 'image' | 'video' | 'audio';

export type JobType =
  | GenerationJobType
  | 'media_extract'
  | 'image_enhance'
  | 'image_erase'
  | 'image_outpaint'
  | 'image_cutout'
  | 'video_subtitle_erase'
  | 'video_enhance'
  | 'vocal_split'
  | 'video_scene_split'
  | 'audio_trim'
  | 'audio_mix'
  | 'audio_video_mux'
  | 'audio_speed'
  | 'video_frame_interpolation'
  | 'video_matting';

export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'checking';

export type ModelCapability = 'text' | 'video' | 'image' | 'audio';
