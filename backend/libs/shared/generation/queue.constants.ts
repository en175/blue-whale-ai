/** 视频唤醒队列名（producer/consumer 单一事实源；BullMQ 队列与 RocketMQ topic 共用）。 */
export const VIDEO_GENERATION_QUEUE = "generation-video";

/** 媒体提取（视频→音频）任务 tag/jobName（IKARDY）：复用 VIDEO_GENERATION_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。 */
export const MEDIA_EXTRACT_TAG = "media_extract";
