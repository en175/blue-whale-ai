/** Persistence limits, measured in UTF-16 code units except canvasBytes (UTF-8). */
export const PROMPT_TEXT_LIMITS = { text: 100_000, title: 200, canvasBytes: 4_194_304 } as const;

/** 提示词上限的缺省值（模型未配 features.max_prompt_length 时）：图片/视频 4000，沿用 ADR-0085 之前的硬编码。 */
export const DEFAULT_PROMPT_MAX_LENGTH = 4_000;
/** 音频的缺省上限（同 ADR-0085 之前）。 */
export const DEFAULT_AUDIO_PROMPT_MAX_LENGTH = 3_000;

export type PromptLengthType = "image" | "video" | "audio";

/**
 * 提示词上限的**唯一**取值口径：**模型配置优先，未配置才回落缺省**。
 *
 * 「提示词」指提交上来的正文全文——ADR-0088 起由提交方给全（前端拼好附件与输入），
 * 服务端不再组合，所以全仓只有这一个上限，没有「正文档 / 组合档」之分（IKH4B8 收敛）。
 *
 * `configured` 只在是 ≥1 的整数时才算「已配置」；脏值（0 / NaN / 小数 / 非数字）一律当未配置，
 * 与读取侧 `pickPositiveInt`、写入口 1–65535 校验同一口径。尤其 NaN：`length > NaN` 恒为 false，
 * 会让闸静默失效。
 */
export function resolvePromptMaxLength(
  type: PromptLengthType,
  configured: number | null | undefined,
): number {
  if (typeof configured === "number" && Number.isInteger(configured) && configured >= 1)
    return configured;
  return type === "audio" ? DEFAULT_AUDIO_PROMPT_MAX_LENGTH : DEFAULT_PROMPT_MAX_LENGTH;
}
