import { describe, expect, it } from 'vitest';
import { limitPromptInput, MAX_PROMPT_INPUT_LENGTH } from './promptInput';

describe('limitPromptInput', () => {
  it('保留最大允许字数并在首次达到上限时提示', () => {
    const result = limitPromptInput('a'.repeat(MAX_PROMPT_INPUT_LENGTH + 1), 'a'.repeat(MAX_PROMPT_INPUT_LENGTH - 1));

    expect(result.value).toHaveLength(MAX_PROMPT_INPUT_LENGTH);
    expect(result.reachedLimit).toBe(true);
  });

  it('已处于上限时不重复触发提示', () => {
    const result = limitPromptInput('a'.repeat(MAX_PROMPT_INPUT_LENGTH + 1), 'a'.repeat(MAX_PROMPT_INPUT_LENGTH));

    expect(result.reachedLimit).toBe(false);
  });
});
