import { describe, expect, it } from 'vitest';
import { matchBlockRule, matchInlineRule } from './markdownInputRules';


describe('matchBlockRule（空格触发）', () => {
  it.each([
    ['#', { kind: 'heading', level: 1 }],
    ['##', { kind: 'heading', level: 2 }],
    ['###', { kind: 'heading', level: 3 }],
    ['-', { kind: 'unordered-list' }],
    ['*', { kind: 'unordered-list' }],
    ['1.', { kind: 'ordered-list' }],
    ['12.', { kind: 'ordered-list' }],
  ])('%s → %s', (input, action) => {
    expect(matchBlockRule(input)?.action).toEqual(action);
  });

  it('非行首标记或普通文本不触发', () => {
    expect(matchBlockRule('####')).toBeNull();
    expect(matchBlockRule('')).toBeNull();
    expect(matchBlockRule('正文')).toBeNull();
    expect(matchBlockRule('# 标题')).toBeNull();
    expect(matchBlockRule('a #')).toBeNull();
  });
});

describe('matchInlineRule（星号/横线闭合触发）', () => {
  it('粗体闭合：**文本** 收尾触发', () => {
    const match = matchInlineRule('前缀**粗体**', '*');
    expect(match?.action).toEqual({ kind: 'bold', text: '粗体' });
    expect(match?.markerLength).toBe(6);
  });

  it('斜体闭合：*文本* 收尾触发（前缀字符不计入标记）', () => {
    const match = matchInlineRule('前缀*斜体*', '*');
    expect(match?.action).toEqual({ kind: 'italic', text: '斜体' });
    expect(match?.markerLength).toBe(4);
  });

  it('行首斜体触发', () => {
    expect(matchInlineRule('*斜体*', '*')?.action).toEqual({ kind: 'italic', text: '斜体' });
  });

  it('三个横线触发分隔线', () => {
    expect(matchInlineRule('---', '-')?.action).toEqual({ kind: 'rule' });
    expect(matchInlineRule('--', '-')).toBeNull();
    expect(matchInlineRule('a--', '-')).toBeNull();
  });

  it('未闭合或空内容不触发', () => {
    expect(matchInlineRule('*未闭合', '*')).toBeNull();
    expect(matchInlineRule('****', '*')).toBeNull();
    expect(matchInlineRule('**', '*')).toBeNull();
    expect(matchInlineRule('正文', '*')).toBeNull();
    expect(matchInlineRule('**粗**', 'x')).toBeNull();
  });
});
