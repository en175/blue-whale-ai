import { describe, expect, it } from 'vitest';
import { countPromptCharacters } from './prompt-characters';

describe('countPromptCharacters', () => {
  it('去掉空格、换行与制表符', () => {
    expect(countPromptCharacters('你好 世界\n第二行\t结尾')).toBe(9);
  });

  it('按 Unicode 码点计数，emoji 算 1 个', () => {
    expect(countPromptCharacters('🐋')).toBe(1);
    expect(countPromptCharacters('a🐋b')).toBe(3);
  });

  it('纯空白为 0', () => {
    expect(countPromptCharacters(' \n\t ')).toBe(0);
  });
});
