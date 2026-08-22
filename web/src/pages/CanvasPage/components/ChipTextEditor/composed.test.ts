import { describe, expect, it } from 'vitest';
import {
  EMPTY_COMPOSED,
  composedFromText,
  composedIsEmpty,
  composedLength,
  composedPreviewText,
  resolveComposed,
  type ComposedValue,
} from './composed';

/** 一张长卡：正是它把字数额度吃光、触发截断、让胶囊被抹掉的。 */
const LONG_PROMPT = 'x'.repeat(3000);

function withChip(): ComposedValue {
  return {
    segments: [
      { kind: 'text', value: '参考 ' },
      { kind: 'ref', ref: { id: 'r1', label: '镜头 3', prompt: LONG_PROMPT } },
      { kind: 'text', value: ' 重做一版' },
    ],
  };
}

describe('composedLength', () => {
  it('一个胶囊算 1 个单位，不按它背后的全文算', () => {
    // 「参考 」3 + 胶囊 1 + 「 重做一版」5 = 9，而不是 3 + 3000 + 5
    expect(composedLength(withChip())).toBe(9);
  });

  it('纯文字就是字符数', () => {
    expect(composedLength(composedFromText('一二三'))).toBe(3);
    expect(composedLength(EMPTY_COMPOSED)).toBe(0);
  });

  it('引十张长卡也不会把额度吃光——这正是原故障的形状', () => {
    const value: ComposedValue = {
      segments: Array.from({ length: 10 }, (_, i) => ({
        kind: 'ref' as const,
        ref: { id: `r${i}`, label: `镜头 ${i}`, prompt: LONG_PROMPT },
      })),
    };
    expect(composedLength(value)).toBe(10);
  });
});

describe('resolveComposed', () => {
  it('提交那一刻才把胶囊换成完整 prompt，位置保持不变', () => {
    expect(resolveComposed(withChip())).toBe(`参考 ${LONG_PROMPT} 重做一版`);
  });

  it('没有胶囊时就是原文', () => {
    expect(resolveComposed(composedFromText('直接出图'))).toBe('直接出图');
  });

  it('空内容解出空串', () => {
    expect(resolveComposed(EMPTY_COMPOSED)).toBe('');
  });
});

describe('composedPreviewText', () => {
  it('编辑期展示用短标签，不展开全文', () => {
    expect(composedPreviewText(withChip())).toBe('参考 镜头 3 重做一版');
  });
});

describe('composedIsEmpty', () => {
  it('纯空白算空', () => {
    expect(composedIsEmpty(composedFromText('   \n  '))).toBe(true);
    expect(composedIsEmpty(EMPTY_COMPOSED)).toBe(true);
  });

  it('只有一个胶囊不算空——它是有内容的，用户就想发它', () => {
    expect(
      composedIsEmpty({ segments: [{ kind: 'ref', ref: { id: 'r', label: 'l', prompt: 'p' } }] }),
    ).toBe(false);
  });

  it('有实字就不算空', () => {
    expect(composedIsEmpty(composedFromText(' 出图 '))).toBe(false);
  });
});

describe('composedFromText', () => {
  it('空串给出空值而不是一个空文本片段', () => {
    expect(composedFromText('')).toEqual(EMPTY_COMPOSED);
  });
});
