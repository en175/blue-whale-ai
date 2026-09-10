export const MAX_PROMPT_INPUT_LENGTH = 1000;

export function limitPromptInput(
  value: string,
  previousValue: string,
  /** 模型目录可配上限（ADR-0085）；缺省沿用默认 1000 */
  max: number = MAX_PROMPT_INPUT_LENGTH,
) {
  const nextValue = value.slice(0, max);
  return {
    value: nextValue,
    reachedLimit: value.length >= max && previousValue.length < max,
  };
}
