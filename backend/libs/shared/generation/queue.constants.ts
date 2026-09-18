/** 生成任务队列名（producer/consumer 单一事实源；RocketMQ topic，单一 topic 承载全部生成任务类型，按 tag 区分）。 */
export const GENERATION_TASK_QUEUE = "generation-task";

/** 媒体提取（视频→音频）任务 tag/jobName（IKARDY）：复用 GENERATION_TASK_QUEUE，用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。 */
export const MEDIA_EXTRACT_TAG = "media_extract";

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

/** 视频生成任务 tag（IKEL9A 刀④；修正六由 "step" 更名为与任务类型同名）：复用 GENERATION_TASK_QUEUE，
 *  用独立 tag 区分任务类型；与 generation_jobs.type 保持一致。消费侧对应 worker-java 的 VideoConsumer.TAG。 */
export const VIDEO_GENERATION_TAG = "video";
