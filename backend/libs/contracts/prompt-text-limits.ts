/** Persistence limits, measured in UTF-16 code units except canvasBytes (UTF-8). */
export const PROMPT_TEXT_LIMITS = { text: 100_000, title: 200, canvasBytes: 4_194_304 } as const;
/** Model-input budget for the composed image prompt (attachments + target prompt), UTF-16 code units. */
export const COMPOSED_IMAGE_PROMPT_MAX_LENGTH = 30_000;
/** Model-input budget for the composed video prompt (attachments + target prompt), UTF-16 code units.
 *  与图片同值并列：各自承载本产品契约预算；模型能力表配了真实上限时以配置为准（IKDLQG / IKH4B8）。 */
export const COMPOSED_VIDEO_PROMPT_MAX_LENGTH = 30_000;
/** Model-input budget for the composed audio prompt (attachments + target prompt), UTF-16 code units.
 *  IKFCXE：音频文本附件与主提示词组合的契约预算，与图片/视频同值并列；
 *  模型能力表配了 max_prompt_length 时以配置为准（IKH4B8）。 */
export const COMPOSED_AUDIO_PROMPT_MAX_LENGTH = 30_000;
/** raw prompt 闸的缺省上限（模型未配 max_prompt_length 时）：沿用 ADR-0085 之前的硬编码。 */
export const RAW_PROMPT_MAX_LENGTH = 4_000;
/** 音频 raw prompt 闸的缺省上限（同 ADR-0085 之前）。 */
export const RAW_AUDIO_PROMPT_MAX_LENGTH = 3_000;

/** 决定未配置时回落哪一档缺省。 */
export type PromptLengthType = "image" | "video" | "audio";
/** 提示词长度闸：raw = 主提示词自身；composed = 文本附件与主提示词组合后。 */
export type PromptLengthGate = "raw" | "composed";

/**
 * 提示词上限的唯一取值口径（IKH4B8）：**模型配置优先，未配置才回落缺省**。
 *
 * 两道闸的缺省不同——raw 沿用旧硬编码（image/video 4000、audio 3000），composed 回落契约预算 30000——
 * 所以调用方必须声明是哪道闸：把 raw 的**生效值**（已含缺省）当 composed 的配置读回去，
 * 会让未配置模型的组合上限从 30000 掉到 4000。
 */
export function resolvePromptMaxLength(
  gate: PromptLengthGate,
  type: PromptLengthType,
  configured: number | null | undefined,
): number {
  if (configured != null) return configured;
  if (gate === "raw") return type === "audio" ? RAW_AUDIO_PROMPT_MAX_LENGTH : RAW_PROMPT_MAX_LENGTH;
  return type === "video"
    ? COMPOSED_VIDEO_PROMPT_MAX_LENGTH
    : type === "audio"
      ? COMPOSED_AUDIO_PROMPT_MAX_LENGTH
      : COMPOSED_IMAGE_PROMPT_MAX_LENGTH;
}
