import { describe, expect, it } from 'vitest';

import { extractSpecs } from './billing-specs.js';

describe('extractSpecs', () => {
  it('只取标量，键统一小写', () => {
    expect(
      extractSpecs({ Size: '2K', Duration: 5, Flag: true, refs: [{ url: 'x' }], none: null }),
    ).toEqual({ size: '2k', duration: '5', flag: 'true', reference_count: '0' });
  });

  it('★ 参考素材数按数组长度进规格 —— 数组本身不进，只取长度', () => {
    // catalog 用 `usage.referenceCount` 配加价倍率，而 `references` 是数组、进不了规格：
    // 没有这个标量键，预扣冻的钱里就不含加价那部分。
    expect(extractSpecs({ references: [{ url: 'a' }, { url: 'b' }] })).toEqual({
      reference_count: '2',
    });
    // 不带 references = 0 个参考素材，写成 0 而不是缺键：这个维度在提交时刻**总是**已知的
    expect(extractSpecs({ size: '2k' })).toEqual({ size: '2k', reference_count: '0' });
  });

  it('★ 创作内容不进规格 —— prompt / title 被排除', () => {
    // 「取所有标量」会把 prompt 也收进来（它是字符串）。后果不是显示问题：
    // 价格预览不必带创作内容，于是预览的规格集合会比预扣少一个键；
    // 今天没有规则按提示词定价所以看不出来，哪天有人配了，**预览价与实扣价就对不上**。
    const specs = extractSpecs({ prompt: '一只猫', title: '我的视频', size: '2k' });

    expect(specs).toEqual({ size: '2k', reference_count: '0' });
    expect(specs).not.toHaveProperty('prompt');
    expect(specs).not.toHaveProperty('title');
  });

  it('大小写不敏感地排除内容字段', () => {
    // 规格键统一小写，排除判定也必须先归一 —— 否则 `Prompt` 会漏网
    expect(extractSpecs({ Prompt: 'x', PROMPT: 'y' })).toEqual({ reference_count: '0' });
  });

  it('★ 按内容长度之类计价应当由上游算成数字规格，而不是塞正文', () => {
    // 这条钉的是「以后有人想按提示词长度定价时该怎么办」的答案：
    // 传 `prompt_length: 128`，不要传 `prompt: '...'`。
    expect(extractSpecs({ prompt_length: 128 })).toEqual({
      prompt_length: '128',
      reference_count: '0',
    });
  });
});
