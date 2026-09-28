import { afterEach, describe, expect, it, vi } from 'vitest';
import { totalCreditsOf } from './auth';
import type { UsageTokenData } from '@/api/auth';

/**
 * 界面上的总积分：按用户口径「各类型相加 = 总积分」。
 *
 * <p>服务端保证 `Σ by_source === credits`（同一条 SQL 的两种投影，有 Java 侧的不变量测试
 * 守着）。这里钉住的是**前端怎么用**这两个数：取相加；真不一致时以账本为准**并且喊出来**
 * ——静默地照常显示，会让服务端两处谓词分叉这件事永远没人发现。
 */
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
    // 一致时不该有告警
    expect(warn).not.toHaveBeenCalled();
  });

  it('by_source 缺失（老服务端）→ 退回服务端的 credits', () => {
    expect(totalCreditsOf({ credits: 888 })).toBe(888);
    expect(warn).not.toHaveBeenCalled();
  });

  it('by_source 为空数组 → 同样退回 credits（不是 0）', () => {
    // 空数组不是「余额为 0」，是「这一版没有分项可给」。当成 0 会让用户看到余额凭空清零。
    expect(totalCreditsOf({ credits: 888, by_source: [] })).toBe(888);
  });

  it('★ 相加与账本不一致：以账本为准，**并且必须喊出来**', () => {
    // 这条不该在真环境发生——发生了说明服务端两处 WHERE 改单边了。
    //
    // ⚠️ 告警断言是这条用例的**重点**，不是附赠：没有它，本函数两个分支返回值完全相同
    //    （一致时返回的和就是账本那个数），于是「by_source 的分支」可以被整段删掉而
    //    全部用例照绿 —— 那正是这次评审抓到的同义反复。
    const data: UsageTokenData = {
      credits: 2500,
      by_source: [{ source: 'purchased', credits: 1500 }],
    };

    expect(totalCreditsOf(data)).toBe(2500);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('不一致');
  });
});
