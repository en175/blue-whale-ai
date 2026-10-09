import { describe, expect, it } from 'vitest';

import {
  customPriceFen,
  formatCredits,
  formatPriceLabel,
  formatPriceYuan,
  snapCredits,
  validateCredits,
} from './customRecharge';


const RULE = {
  min_credits: 600,
  max_credits: 499_995,
  default_credits: 600,
  step_credits: 15,
  credits_per_yuan: 15,
};

describe('customPriceFen — 与服务端同一个式子', () => {
  it('★ PRD §7.6「价格计算」：600 积分 = ¥40、900 = ¥60、499,995 = ¥33,333', () => {
    expect(customPriceFen(600, 15)).toBe(4_000);
    expect(customPriceFen(900, 15)).toBe(6_000);
    expect(customPriceFen(499_995, 15)).toBe(3_333_300);
  });

  it('★ 四舍五入到分：601 积分 = ¥40.07（零头平台承担，不改积分数）', () => {
    expect(customPriceFen(601, 15)).toBe(4_007);
    expect(customPriceFen(1, 15)).toBe(7);
  });

  it('整元价不漂：逐格对一遍（浮点误差会在这条红）', () => {
    for (let credits = 600; credits <= 9_000; credits += 15) {
      expect(customPriceFen(credits, 15)).toBe((credits / 15) * 100);
    }
  });

  it('换算率非法 → 0（前端不编价格；服务端那边是直接抛错）', () => {
    expect(customPriceFen(600, 0)).toBe(0);
    expect(customPriceFen(600, -1)).toBe(0);
    expect(customPriceFen(600, Number.NaN)).toBe(0);
  });
});

describe('formatPriceYuan / formatPriceLabel — 展示精度到分', () => {
  it('整元不带小数，带零头保留两位（PRD §7.3「避免出现无法支付的小数金额」）', () => {
    expect(formatPriceYuan(4_000)).toBe('40');
    expect(formatPriceYuan(4_007)).toBe('40.07');
    expect(formatPriceYuan(3_333_300)).toBe('33333');
  });

  it('价格标签 = ¥ + 上面那个串', () => {
    expect(formatPriceLabel(600, 15)).toBe('¥40');
    expect(formatPriceLabel(601, 15)).toBe('¥40.07');
  });

  it('积分千分位：六位数读起来不费劲', () => {
    expect(formatCredits(600)).toBe('600');
    expect(formatCredits(499_995)).toBe('499,995');
  });
});

describe('snapCredits — 修正到合法格点（PRD §7.3「自动修正为合法值」）', () => {
  it('空 / NaN / 非有限 → 默认值', () => {
    expect(snapCredits(null, RULE)).toBe(600);
    expect(snapCredits(undefined, RULE)).toBe(600);
    expect(snapCredits(Number.NaN, RULE)).toBe(600);
    expect(snapCredits(Number.POSITIVE_INFINITY, RULE)).toBe(600);
  });

  it('★ 低于最低 → 抬到最低；高于最高 → 压到最高（PRD §7.3）', () => {
    expect(snapCredits(1, RULE)).toBe(600);
    expect(snapCredits(-999, RULE)).toBe(600);
    expect(snapCredits(999_999, RULE)).toBe(499_995);
  });

  it('★ 吸附到最近的格点（不是向零取整，也不是向上取整）', () => {
    expect(snapCredits(4_996, RULE)).toBe(4_995);
    expect(snapCredits(5_000, RULE)).toBe(4_995);
    expect(snapCredits(5_009, RULE)).toBe(5_010);
  });

  it('小数输入先取整再吸附', () => {
    expect(snapCredits(600.4, RULE)).toBe(600);
    expect(snapCredits(601.6, RULE)).toBe(600);
  });

  it('已经是格点上的值不动（幂等）', () => {
    for (let credits = 600; credits <= 1_500; credits += 15) {
      expect(snapCredits(credits, RULE)).toBe(credits);
    }
  });

  it('步长为 1 时只夹范围，不做吸附', () => {
    const rule = { ...RULE, step_credits: 1 };
    expect(snapCredits(601, rule)).toBe(601);
    expect(snapCredits(0, rule)).toBe(600);
  });
});

describe('validateCredits — 提示文案要带具体数字', () => {
  it('合法值 → null', () => {
    expect(validateCredits(600, RULE)).toBeNull();
    expect(validateCredits(900, RULE)).toBeNull();
    expect(validateCredits(499_995, RULE)).toBeNull();
  });

  it('★ 低于最低 / 高于最高 → 提示具体数额（PRD §7.3）', () => {
    expect(validateCredits(599, RULE)).toBe('最低充值 600 积分');
    expect(validateCredits(500_000, RULE)).toBe('最高充值 499,995 积分');
  });

  it('不在步长格点上 → 提示步长', () => {
    expect(validateCredits(601, RULE)).toBe('积分数量须为 15 的整数倍');
  });

  it('非整数 / 空 → 提示范围，而不是抛错', () => {
    expect(validateCredits(600.5, RULE)).toMatch(/请输入/);
    expect(validateCredits(null, RULE)).toMatch(/请输入/);
    expect(validateCredits(Number.NaN, RULE)).toMatch(/请输入/);
  });
});
