export const MAX_PROMPT_INPUT_LENGTH = 1000;

export function limitPromptInput(
  value: string,
  previousValue: string,
  max: number | null = MAX_PROMPT_INPUT_LENGTH,
) {
  if (max == null) return { value, reachedLimit: false };
  const nextValue = value.slice(0, max);
  return {
    value: nextValue,
    reachedLimit: value.length >= max && previousValue.length < max,
  };
}
