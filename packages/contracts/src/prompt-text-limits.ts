/** Persistence limits, measured in UTF-16 code units except canvasBytes (UTF-8). */
export const PROMPT_TEXT_LIMITS = { text: 100_000, title: 200, canvasBytes: 4_194_304 } as const;
/** Model-input budget for the composed image prompt (attachments + target prompt), UTF-16 code units. */
export const COMPOSED_IMAGE_PROMPT_MAX_LENGTH = 30_000;
/** Model-input budget for the composed video prompt (attachments + target prompt), UTF-16 code units.
 *  与图片同值并列：各自承载本产品契约预算，模型能力表给出真实上限时分别对齐（IKDLQG）。 */
export const COMPOSED_VIDEO_PROMPT_MAX_LENGTH = 30_000;
/** Model-input budget for the composed audio prompt (attachments + target prompt), UTF-16 code units.
 *  IKFCXE：音频文本附件与主提示词组合的契约预算，与图片/视频同值并列；
 *  模型能力表 max_prompt_length 给出更大真实上限时组合闸取大对齐。 */
export const COMPOSED_AUDIO_PROMPT_MAX_LENGTH = 30_000;
