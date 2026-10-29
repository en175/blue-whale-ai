const MQ_ENV_SUFFIX = (process.env.MQ_ENV_SUFFIX ?? "").trim().replace(/^-+/, "");

export const GENERATION_TASK_TOPIC = "generation-task";

export const GENERATION_TASK_QUEUE = MQ_ENV_SUFFIX
  ? `${GENERATION_TASK_TOPIC}-${MQ_ENV_SUFFIX}`
  : GENERATION_TASK_TOPIC;

export const MEDIA_EXTRACT_TAG = "media_extract";

export const AUDIO_MIX_TAG = "audio_mix";

export const AUDIO_VIDEO_MUX_TAG = "audio_video_mux";

export const AUDIO_TRIM_TAG = "audio_trim";

export const AUDIO_SPEED_TAG = "audio_speed";

export const IMAGE_GENERATION_TAG = "image";

export const AUDIO_GENERATION_TAG = "audio";

export const IMAGE_ENHANCE_TAG = "image_enhance";

export const IMAGE_ERASE_TAG = "image_erase";

export const IMAGE_CUTOUT_TAG = "image_cutout";
export const IMAGE_OUTPAINT_TAG = "image_outpaint";
export const VIDEO_SUBTITLE_ERASE_TAG = "video_subtitle_erase";

export const VIDEO_ENHANCE_TAG = "video_enhance";

export const VOCAL_SPLIT_TAG = "vocal_split";
export const VIDEO_SCENE_SPLIT_TAG = "video_scene_split";

export const VIDEO_MATTING_TAG = "video_matting";
export const VIDEO_FRAME_INTERPOLATION_TAG = "video_frame_interpolation";

export const VIDEO_GENERATION_TAG = "video";

export type GenerationTag =
  | typeof VIDEO_GENERATION_TAG
  | typeof IMAGE_GENERATION_TAG
  | typeof AUDIO_GENERATION_TAG
  | typeof MEDIA_EXTRACT_TAG
  | typeof AUDIO_MIX_TAG
  | typeof AUDIO_VIDEO_MUX_TAG
  | typeof AUDIO_TRIM_TAG
  | typeof AUDIO_SPEED_TAG
  | typeof IMAGE_ENHANCE_TAG
  | typeof IMAGE_ERASE_TAG
  | typeof IMAGE_CUTOUT_TAG
  | typeof IMAGE_OUTPAINT_TAG
  | typeof VIDEO_SUBTITLE_ERASE_TAG
  | typeof VIDEO_ENHANCE_TAG
  | typeof VOCAL_SPLIT_TAG
  | typeof VIDEO_SCENE_SPLIT_TAG
  | typeof VIDEO_MATTING_TAG
  | typeof VIDEO_FRAME_INTERPOLATION_TAG;
