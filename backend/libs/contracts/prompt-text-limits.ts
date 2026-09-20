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
/** 未配置时回落的缺省档：`legacy-hardcode` = ADR-0085 之前的硬编码；`contract-budget` = 契约预算。
 *  参数选的是**回落档**，不是「量的是哪段字符串」——同一档会被量不同字符串的闸共用（见下）。 */
export type PromptLengthBudget = "legacy-hardcode" | "contract-budget";

/**
 * 提示词上限的唯一取值口径（IKH4B8）：**模型配置优先，未配置才回落缺省**。
 *
 * 两档缺省并存，且与「闸量的是哪段字符串」**不是一一对应**——调用方声明要哪档回落：
 * - `legacy-hardcode`：主提示词自身的旧硬编码（图片/视频 4000、音频 3000）。只给 raw 闸用。
 * - `contract-budget`：契约预算 30000。**组合闸**（量「附件 + 主提示词」）与**方案卡闸**
 *   （量方案卡正文自身）都用它——后者量的其实是 raw 长度，但从 ADR-0085 起就沿用组合口径，
 *   给它换成 raw 档会把缺省从 30000 砍到 4000，属行为回归。
 *
 * 另注意：**不要把 raw 闸的生效值（已含缺省）当装配配置读回来**——那会让未配置模型的组合上限
 * 从 30000 掉到 4000。传配置原值，回落交给这里。
 *
 * `configured` 只在是 ≥1 的整数时才算「已配置」；脏值（0 / NaN / 小数 / 非数字）一律当未配置，
 * 与读取侧 `pickPositiveInt`、写入口 1–65535 校验同一口径。尤其 NaN：`length > NaN` 恒为 false，
 * 会让闸静默失效。
 */
export function resolvePromptMaxLength(
  budget: PromptLengthBudget,
  type: PromptLengthType,
  configured: number | null | undefined,
): number {
  if (typeof configured === "number" && Number.isInteger(configured) && configured >= 1)
    return configured;
  if (budget === "legacy-hardcode")
    return type === "audio" ? RAW_AUDIO_PROMPT_MAX_LENGTH : RAW_PROMPT_MAX_LENGTH;
  return type === "video"
    ? COMPOSED_VIDEO_PROMPT_MAX_LENGTH
    : type === "audio"
      ? COMPOSED_AUDIO_PROMPT_MAX_LENGTH
      : COMPOSED_IMAGE_PROMPT_MAX_LENGTH;
}
