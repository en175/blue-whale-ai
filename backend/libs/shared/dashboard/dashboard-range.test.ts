import { describe, expect, it } from "vitest";
import { AdminException } from "@lib/shared/errors/admin-error.js";

import { beijingDayOf, resolveDashboardRange, withinRange } from "./dashboard-range.js";

/** 北京时间的某个瞬时（测试里只关心它落在哪个北京自然日）。 */
const beijing = (day: string, time = "12:00:00") => new Date(`${day}T${time}+08:00`);

describe("beijingDayOf —— 按北京时间取自然日", () => {
  it("服务器在 UTC 时，北京时间 00:00–08:00 之间**不能**退回前一天", () => {
    // 2026-09-25T17:30Z = 北京 2026-09-26 01:30。容器里通常是 UTC，
    // 用 toISOString().slice(0,10) 会得到 09-25，那是错的
    expect(beijingDayOf(new Date("2026-09-25T17:30:00Z"))).toBe("2026-09-26");
    // 2026-09-25T15:59Z = 北京 2026-09-25 23:59，仍是当天
    expect(beijingDayOf(new Date("2026-09-25T15:59:00Z"))).toBe("2026-09-25");
  });

  it("跨零点前后各差一秒，落在两个不同的北京自然日", () => {
    expect(beijingDayOf(new Date("2026-09-25T15:59:59Z"))).toBe("2026-09-25");
    expect(beijingDayOf(new Date("2026-09-25T16:00:00Z"))).toBe("2026-09-26");
  });
});

describe("resolveDashboardRange —— 默认今天", () => {
  it("两个参数都不给 = 今天（**按北京时间**，不是服务器本地时区）", () => {
    const range = resolveDashboardRange({}, new Date("2026-09-25T17:30:00Z"));

    expect(range).toMatchObject({ from: "2026-09-26", to: "2026-09-26" });
  });

  it("默认区间的两个端点就是当天的北京零点与次日零点", () => {
    const range = resolveDashboardRange({}, beijing("2026-09-25"));

    expect(range.start.toISOString()).toBe("2026-09-24T16:00:00.000Z"); // 北京 09-25 00:00
    expect(range.endExclusive.toISOString()).toBe("2026-09-25T16:00:00.000Z"); // 北京 09-26 00:00
  });
});

describe("resolveDashboardRange —— 显式区间", () => {
  it("上界是**次日零点且不含**：DATETIME 只到秒，用 23:59:59 会漏掉那一秒里的行", () => {
    const range = resolveDashboardRange({ from: "2026-09-01", to: "2026-09-30" });

    expect(range.start.toISOString()).toBe("2026-08-31T16:00:00.000Z"); // 北京 09-01 00:00
    expect(range.endExclusive.toISOString()).toBe("2026-09-30T16:00:00.000Z"); // 北京 10-01 00:00
    // 半开：端点本身必须落在区间内，次日的零点必须落在区间外
    expect(range.endExclusive.getTime()).toBeGreaterThan(
      beijing("2026-09-30", "23:59:59").getTime(),
    );
  });

  it("单日区间（from = to）是合法的，覆盖那一个自然日", () => {
    const range = resolveDashboardRange({ from: "2026-09-25", to: "2026-09-25" });

    expect(range.endExclusive.getTime() - range.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("两端都是北京时间零点，与服务器本地时区无关", () => {
    const range = resolveDashboardRange({ from: "2026-01-01", to: "2026-01-01" });

    // 北京时间零点 = UTC 前一天 16:00。任何本地时区都不影响这个结果
    expect(range.start.toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });
});

describe("resolveDashboardRange —— 30 天上限", () => {
  it("正好 30 天（含首尾）放行", () => {
    // 09-01 ~ 09-30 含首尾正是 30 天
    expect(() =>
      resolveDashboardRange({ from: "2026-09-01", to: "2026-09-30" }),
    ).not.toThrow();
  });

  it("31 天**拒绝**，且错误里说清当前多少天", () => {
    // ⚠️ 必须拒绝而不是静默截断成最近 30 天：截断后界面显示的是一组不完整的数，
    //    而没有任何东西提示它不完整
    expect(() => resolveDashboardRange({ from: "2026-09-01", to: "2026-10-01" })).toThrow(
      /最多 30 天，当前为 31 天/,
    );
  });

  it("拒绝时抛的是 400（前端能按状态码判，不必读文案）", () => {
    try {
      resolveDashboardRange({ from: "2026-01-01", to: "2026-12-31" });
      expect.unreachable("超限区间必须抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminException);
      expect((error as AdminException).status).toBe(400);
    }
  });

  it("上限按**自然日**算，跨月跨年都不影响", () => {
    // 12-05 ~ 01-03 含首尾 = 30 天
    expect(() =>
      resolveDashboardRange({ from: "2026-12-05", to: "2027-01-03" }),
    ).not.toThrow();
    expect(() => resolveDashboardRange({ from: "2026-12-05", to: "2027-01-04" })).toThrow(
      /最多 30 天/,
    );
  });
});

describe("resolveDashboardRange —— 非法入参一律 400", () => {
  const rejected: Array<[string, { from?: string; to?: string }]> = [
    ["格式缺零", { from: "2026-9-5", to: "2026-9-6" }],
    ["没有分隔符", { from: "20260905", to: "20260906" }],
    ["带时间", { from: "2026-09-05T00:00:00", to: "2026-09-06" }],
    ["不存在的日期（02-30 会被 V8 悄悄滚到 3 月）", { from: "2026-02-30", to: "2026-03-01" }],
    ["只给 from", { from: "2026-09-05" }],
    ["只给 to", { to: "2026-09-05" }],
    ["起始晚于结束", { from: "2026-09-06", to: "2026-09-05" }],
    ["空串等于没给（与只给一个同罪）", { from: "", to: "2026-09-05" }],
  ];

  for (const [name, input] of rejected) {
    it(`拒绝：${name}`, () => {
      expect(() => resolveDashboardRange(input)).toThrow(AdminException);
    });
  }

  it("反向区间必须报错：空集与「这段时间真的没有数据」在界面上长得一模一样", () => {
    expect(() => resolveDashboardRange({ from: "2026-09-06", to: "2026-09-05" })).toThrow(
      /起始日期不能晚于结束日期/,
    );
  });

  it("两端空白串 = 都没给 = 今天（不当作显式区间）", () => {
    const range = resolveDashboardRange({ from: "  ", to: "" }, beijing("2026-09-25"));

    expect(range).toMatchObject({ from: "2026-09-25", to: "2026-09-25" });
  });
});

describe("withinRange —— 交给 Prisma 的时间条件", () => {
  it("是与区间端点逐字相同的半开条件", () => {
    const range = resolveDashboardRange({ from: "2026-09-01", to: "2026-09-30" });

    expect(withinRange(range)).toEqual({ gte: range.start, lt: range.endExclusive });
  });
});
