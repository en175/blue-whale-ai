/** 生成任务队列名（producer/consumer 单一事实源；RocketMQ topic，单一 topic 承载全部生成任务类型，按 tag 区分）。 */
export const GENERATION_TASK_QUEUE = "generation-task";

/** 媒体提取（视频→音频）任务 tag/jobName（IKARDY）：复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。 */
export const MEDIA_EXTRACT_TAG = "media_extract";

/** 音频混合任务单独消费，值与 generation_jobs.type 一致。 */
export const AUDIO_MIX_TAG = "audio_mix";

/** 音视频合成任务 tag（IKIHPJ，父规格 IKIHMX，契约见 @lib/contracts/audio-video-mux）：复用
 *  GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type /
 *  AUDIO_VIDEO_MUX_JOB_TYPE（@lib/contracts）保持一致。 */
export const AUDIO_VIDEO_MUX_TAG = "audio_video_mux";

/** 音频截取（音频卡「截取」，火山 MediaKit trim-audio）任务 tag（IKHB6S，契约见
 *  @lib/contracts/audio-trim）：复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；
 *  与 generation_jobs.type / AUDIO_TRIM_JOB_TYPE（@lib/contracts）保持一致。 */
export const AUDIO_TRIM_TAG = "audio_trim";

/** 音频调速（音频卡「调速」，火山 MediaKit adjust-audio-speed）任务 tag（IKHW59，契约见
 *  @lib/contracts/audio-speed）：复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；
 *  与 generation_jobs.type / AUDIO_SPEED_JOB_TYPE（@lib/contracts）保持一致。 */
export const AUDIO_SPEED_TAG = "audio_speed";

/** 图片生成任务 tag（IKBGKA）：复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。 */
export const IMAGE_GENERATION_TAG = "image";

/** 音频生成任务 tag（IKCR78）：复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。 */
export const AUDIO_GENERATION_TAG = "audio";

/** 高清放大任务 tag（IKGM8U，契约 §14）：复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；
 *  与 generation_jobs.type / IMAGE_ENHANCE_JOB_TYPE（@lib/contracts）保持一致。 */
export const IMAGE_ENHANCE_TAG = "image_enhance";

/** 图片擦除任务 tag（IKGOT3，契约 §15）：复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；
 *  与 generation_jobs.type / IMAGE_ERASE_JOB_TYPE（@lib/contracts）保持一致。 */
export const IMAGE_ERASE_TAG = "image_erase";

/** 图片抠图任务 tag（IKGXLS，契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md）：
 *  复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；
 *  与 generation_jobs.type / IMAGE_CUTOUT_JOB_TYPE（@lib/contracts）保持一致。 */
export const IMAGE_CUTOUT_TAG = "image_cutout";
/** 智能扩图任务 tag（IKGOQR，契约见 @lib/contracts/image-outpaint）：复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；
 *  与 generation_jobs.type / IMAGE_OUTPAINT_JOB_TYPE（@lib/contracts）保持一致。 */
export const IMAGE_OUTPAINT_TAG = "image_outpaint";
/** 视频智能去字幕任务 tag（IKGZ7Z，迁移契约 §17，契约见 @lib/contracts/video-subtitle-erase）：
 *  复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；
 *  与 generation_jobs.type / VIDEO_SUBTITLE_ERASE_JOB_TYPE（@lib/contracts）保持一致。 */
export const VIDEO_SUBTITLE_ERASE_TAG = "video_subtitle_erase";

/** 视频 HD 高清任务 tag（IKH3VE，契约见 @lib/contracts/video-enhance）：复用 GENERATION_TASK_QUEUE，
 *  用独立 tag 区分任务类型；与 generation_jobs.type / VIDEO_ENHANCE_JOB_TYPE（@lib/contracts）保持一致。 */
export const VIDEO_ENHANCE_TAG = "video_enhance";

/** 人声背景分离任务 tag（IKHA2C，契约见 @lib/contracts/vocal-split）：复用 GENERATION_TASK_QUEUE，
 *  用独立 tag 区分任务类型；与 generation_jobs.type / VOCAL_SPLIT_JOB_TYPE（@lib/contracts）保持一致。 */
export const VOCAL_SPLIT_TAG = "vocal_split";
/** 视频场景切分任务 tag（IKH8BH，契约见 @lib/contracts/video-scene-split）：复用 GENERATION_TASK_QUEUE，
 *  用独立 tag 区分任务类型；与 generation_jobs.type / VIDEO_SCENE_SPLIT_JOB_TYPE（@lib/contracts）保持一致。 */
export const VIDEO_SCENE_SPLIT_TAG = "video_scene_split";

/** 智能抠像任务 tag（IKHK7F，契约见 @lib/contracts/video-matting）：复用 GENERATION_TASK_QUEUE，
 *  用独立 tag 区分任务类型；与 generation_jobs.type / VIDEO_MATTING_JOB_TYPE（@lib/contracts）保持一致。 */
export const VIDEO_MATTING_TAG = "video_matting";
/** 视频插帧任务 tag（IKHLK3，父需求 IKHLES，契约见 @lib/contracts/video-frame-interpolation）：复用
 *  GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type /
 *  VIDEO_FRAME_INTERPOLATION_JOB_TYPE（@lib/contracts）保持一致。 */
export const VIDEO_FRAME_INTERPOLATION_TAG = "video_frame_interpolation";

/** 视频生成任务 tag（IKEL9A 刀④；修正六由 "step" 更名为与任务类型同名）：复用 GENERATION_TASK_QUEUE，
 *  用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。消费侧对应 worker-java 的 VideoConsumer.TAG。 */
export const VIDEO_GENERATION_TAG = "video";

/** 十八个 tag 的联合类型：入队函数只接受这些值，避免在新调用点发明字面量（修正六后 tag 已无 env 覆盖，
 *  发明一个字符串不会有任何运行时报错，只会静默滞留）。 */
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
