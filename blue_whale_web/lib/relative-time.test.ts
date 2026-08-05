import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

const NOW = new Date("2026-08-03T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("一分钟内显示「刚刚」（含未来时间防御）", () => {
    expect(formatRelativeTime(NOW / 1000 - 30, NOW)).toBe("刚刚");
    expect(formatRelativeTime(NOW / 1000 + 60, NOW)).toBe("刚刚");
  });

  it("分钟/小时/天分级", () => {
    expect(formatRelativeTime(NOW / 1000 - 53 * 60, NOW)).toBe("53分钟前");
    expect(formatRelativeTime(NOW / 1000 - 3 * 3600, NOW)).toBe("3小时前");
    expect(formatRelativeTime(NOW / 1000 - 26 * 3600, NOW)).toBe("1天前");
    expect(formatRelativeTime(NOW / 1000 - 5 * 86400, NOW)).toBe("5天前");
  });

  it("超过 30 天显示具体日期", () => {
    expect(formatRelativeTime(NOW / 1000 - 40 * 86400, NOW)).toBe("2026-06-24");
  });

  it("非法输入兜底", () => {
    expect(formatRelativeTime(0, NOW)).toBe("—");
    expect(formatRelativeTime(Number.NaN, NOW)).toBe("—");
  });
});
