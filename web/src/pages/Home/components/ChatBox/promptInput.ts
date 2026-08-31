export const MAX_PROMPT_INPUT_LENGTH = 1000;

export function limitPromptInput(value: string, previousValue: string) {
  const nextValue = value.slice(0, MAX_PROMPT_INPUT_LENGTH);
  return {
    value: nextValue,
    reachedLimit: value.length >= MAX_PROMPT_INPUT_LENGTH && previousValue.length < MAX_PROMPT_INPUT_LENGTH,
  };
}
