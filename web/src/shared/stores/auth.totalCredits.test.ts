import { afterEach, describe, expect, it, vi } from 'vitest';
import { totalCreditsOf } from './auth';
import type { UsageTokenData } from '@/app/api/auth';

describe('totalCreditsOf', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  it('有 by_source 时按各类型相加（充值 + 充值赠送 = 总积分）', () => {
    const data: UsageTokenData = {
      credits: 2500,
      by_source: [
        { source: 'purchased', credits: 1500 },
        { source: 'bonus', credits: 1000 },
      ],
    };

    expect(totalCreditsOf(data)).toBe(2500);
    expect(warn).not.toHaveBeenCalled();
  });

  it('by_source 缺失（老服务端）→ 退回服务端的 credits', () => {
    expect(totalCreditsOf({ credits: 888 })).toBe(888);
    expect(warn).not.toHaveBeenCalled();
  });

  it('by_source 为空数组 → 同样退回 credits（不是 0）', () => {
    expect(totalCreditsOf({ credits: 888, by_source: [] })).toBe(888);
  });

  it('★ 相加与账本不一致：以账本为准，**并且必须喊出来**', () => {
    const data: UsageTokenData = {
      credits: 2500,
      by_source: [{ source: 'purchased', credits: 1500 }],
    };

    expect(totalCreditsOf(data)).toBe(2500);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('不一致');
  });
});
