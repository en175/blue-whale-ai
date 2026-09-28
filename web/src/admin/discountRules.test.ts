import { describe, expect, it } from 'vitest';
import {
  bpToZhe,
  combineFactors,
  describeFloor,
  describePatterns,
  describeSchedule,
  describeStackMode,
  describeTiers,
  formatDiscount,
  parseZheToBp,
  shortDateTime,
  shortTime,
  statusLabel,
  tierLabel,
  zheToBp,
} from './discountRules';

/**
 * 折扣展示口径的纯函数测试。
 *
 * <p>两个折扣页都要做同一件事：把库里的**万分比**翻译成运营认得的「折」。
 * 这份测试钉住的是换算与「人话」的边界 —— 最典型的翻车是「一边显示 9 折、
 * 另一边显示 0.9 折」，而两边看起来都正常。
 */
describe('万分比 ↔ 折', () => {
  it('9000 = 9 折，1000 = 1 折', () => {
    expect(bpToZhe(9000)).toBe(9);
    expect(zheToBp(9)).toBe(9000);
    expect(zheToBp(8.5)).toBe(8500);
  });

  it('小数折四舍五入到整数万分比', () => {
    // 8.555 折 → 8555 万分比（库里是整数列，多出来的精度只能舍）
    expect(parseZheToBp('8.555')).toBeNull(); // 超过两位小数直接拒，不做静默截断
    expect(parseZheToBp('8.55')).toBe(8550);
  });

  it('折数不合法一律 null —— 不兜底成 0（0 在库里是「免费」）', () => {
    // 0 折 = 白送，1.1 折这种笔误也不该被当成合法输入放进去
    for (const raw of ['', '  ', '0', '0.0', '11', '-1', '九折', '9折', '1e3']) {
      expect(parseZheToBp(raw), raw).toBeNull();
    }
  });

  it('10 折是原价，允许（等于不打折）', () => {
    expect(parseZheToBp('10')).toBe(10_000);
  });

  it('原价不写成「10 折」—— 运营看到「10 折」会以为是打了折', () => {
    expect(formatDiscount(10_000)).toBe('不打折（原价）');
    expect(formatDiscount(9000)).toBe('9 折');
    expect(formatDiscount(8500)).toBe('8.5 折');
  });
});

describe('条件的人话', () => {
  it('空集合 = 不限（两种表示都说同一句）', () => {
    expect(describePatterns([], '不限')).toBe('不限');
    expect(describePatterns(null, '不限')).toBe('不限');
    expect(describePatterns(['*'], '不限')).toBe('*');
  });

  it('等级回退：认不出的值原样显示（显示 PRO 只是不好看，显示空白没法排查）', () => {
    expect(tierLabel('pro')).toBe('专业');
    expect(tierLabel('PRO')).toBe('PRO');
    expect(describeTiers(['pro', 'max'])).toBe('专业、旗舰');
    expect(describeTiers(null)).toBe('不限等级');
  });

  it('时段：没配就是全天，且这句话必须说出来', () => {
    expect(
      describeSchedule({
        daysOfWeek: null,
        dailyTimeStart: null,
        dailyTimeEnd: null,
        tz: 'Asia/Shanghai',
      }),
    ).toBe('每天 全天（Asia/Shanghai）');

    expect(
      describeSchedule({
        daysOfWeek: [1, 5],
        dailyTimeStart: '22:00:00',
        dailyTimeEnd: '06:00:00',
        tz: 'Asia/Shanghai',
      }),
    ).toBe('周一、周五 22:00–06:00（Asia/Shanghai）');
  });

  it('库里的 22:00:00 在界面上说成 22:00', () => {
    expect(shortTime('22:00:00')).toBe('22:00');
    expect(shortTime(null)).toBeNull();
    expect(shortDateTime('2026-10-01T00:00:00')).toBe('2026-10-01 00:00');
    expect(shortDateTime(null)).toBe('');
  });

  it('状态：认不出的值原样显示', () => {
    expect(statusLabel('enabled')).toBe('启用');
    expect(statusLabel('paused')).toBe('paused');
  });
});

describe('目录级策略的只读展示', () => {
  it('两种叠加方式说清差别（运营靠这句话判断该配多少）', () => {
    expect(describeStackMode('multiply')).toContain('相乘');
    expect(describeStackMode('best')).toContain('取优');
  });

  it('底线按折说，10000 说成「等于不设底线」', () => {
    expect(describeFloor(3000)).toBe('3 折（3000）');
    expect(describeFloor(10_000)).toContain('等于不设底线');
  });

  it('叠加计算与计价侧同一口径（multiply 相乘、best 取优）', () => {
    // 8 折 × 7 折 = 5.6 折；best 则是 7 折
    expect(combineFactors(8000, 7000, 'multiply')).toBe(5600);
    expect(combineFactors(8000, 7000, 'best')).toBe(7000);
  });
});
