export const PROMPT_TEXT_LIMITS = { text: 100_000, title: 200, canvasBytes: 4_194_304 } as const;

export const DEFAULT_PROMPT_MAX_LENGTH = 4_000;
export const DEFAULT_AUDIO_PROMPT_MAX_LENGTH = 3_000;

export type PromptLengthType = "image" | "video" | "audio";

export function resolvePromptMaxLength(
  type: PromptLengthType,
  configured: number | null | undefined,
): number {
  if (typeof configured === "number" && Number.isInteger(configured) && configured >= 1)
    return configured;
  return type === "audio" ? DEFAULT_AUDIO_PROMPT_MAX_LENGTH : DEFAULT_PROMPT_MAX_LENGTH;
}
