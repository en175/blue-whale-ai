import { describe, expect, it } from 'vitest';
import { describePricing, parsePricingDraft, pricingEditorText } from './pricingDraft';

describe('parsePricingDraft', () => {
  it('接受 JSON 对象并原样返回', () => {
    const result = parsePricingDraft('{"baseUnit":"usage.seconds","minCredits":1}');
    expect(result).toEqual({
      ok: true,
      value: { baseUnit: 'usage.seconds', minCredits: 1 },
    });
  });

  it('拒绝空内容', () => {
    expect(parsePricingDraft('   ')).toEqual({ ok: false, error: '计价规则不能为空' });
  });

  it('拒绝非对象 JSON', () => {
    expect(parsePricingDraft('[1,2]')).toEqual({ ok: false, error: '计价规则必须是 JSON 对象' });
    expect(parsePricingDraft('null')).toEqual({ ok: false, error: '计价规则必须是 JSON 对象' });
  });

  it('语法错误时带出解析原因', () => {
    const result = parsePricingDraft('{oops}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('计价规则不是合法 JSON');
  });
});

describe('pricingEditorText', () => {
  it('按两空格缩进输出', () => {
    expect(pricingEditorText({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('describePricing', () => {
  it('按分钟单价描述固定价并带上取整信息', () => {
    expect(
      describePricing({
        baseUnit: 'usage.seconds',
        basePrice: { kind: 'const', value: 1000 },
        unitDenominator: 60,
        quantityStep: 60,
        minCredits: 1,
      }),
    ).toBe('1 积分 / 分钟（按 60 秒向上取整，最低 1 积分）');
  });

  it('按分档描述表格价', () => {
    expect(
      describePricing({
        baseUnit: 'usage.seconds',
        basePrice: {
          kind: 'table',
          by: ['resolution'],
          table: { 'resolution=1080p': 3000, 'resolution=4k': 9000 },
        },
        unitDenominator: 60,
      }),
    ).toBe('resolution 分档（积分 / 分钟）：resolution=1080p → 3 积分；resolution=4k → 9 积分');
  });

  it('缺 benchmark 维度时给出未识别提示', () => {
    expect(describePricing({ minCredits: 1 })).toBe('未识别的计价结构');
  });
});
