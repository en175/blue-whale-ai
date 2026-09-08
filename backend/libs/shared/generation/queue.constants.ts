/** 视频唤醒队列名（producer/consumer 单一事实源；RocketMQ topic）。 */
export const VIDEO_GENERATION_QUEUE = "generation-video";

/** 媒体提取（视频→音频）任务 tag/jobName（IKARDY）：复用 VIDEO_GENERATION_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。 */
export const MEDIA_EXTRACT_TAG = "media_extract";

/** 图片生成任务 tag（IKBGKA）：复用 VIDEO_GENERATION_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。 */
export const IMAGE_GENERATION_TAG = "image";

/** 音频生成任务 tag（IKCR78）：复用 VIDEO_GENERATION_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。 */
export const AUDIO_GENERATION_TAG = "audio";
