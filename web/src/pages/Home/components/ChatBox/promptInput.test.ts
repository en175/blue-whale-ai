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

  it('显式 max（模型目录上限，ADR-0085）覆盖默认值', () => {
    const result = limitPromptInput('a'.repeat(3001), 'a'.repeat(2999), 3000);

    expect(result.value).toHaveLength(3000);
    expect(result.reachedLimit).toBe(true);
  });

  it('缺省参数保持旧行为（1000 默认）', () => {
    const result = limitPromptInput('a'.repeat(1001), 'a'.repeat(1000));

    expect(result.value).toHaveLength(MAX_PROMPT_INPUT_LENGTH);
  });
});
