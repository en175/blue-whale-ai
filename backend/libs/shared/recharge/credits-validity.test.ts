import { describe, expect, it } from "vitest";

import { creditsExpireAt } from "./credits-validity.js";


describe("creditsExpireAt — 订单快照里的有效期", () => {
  it("按支付成功时间起算，加配置的月数（PRD §9.5）", () => {
    const paidAt = new Date("2026-09-27T10:00:00.000Z");
    const expire = creditsExpireAt(paidAt, 24);
    expect(expire.getUTCFullYear()).toBe(2028);
    expect(expire.getUTCMonth()).toBe(8);
    expect(paidAt.toISOString()).toBe("2026-09-27T10:00:00.000Z");
  });

  it("运营配 6 个月就是 6 个月：月数原样生效，不是被写死的 2 年", () => {
    const paidAt = new Date("2026-09-27T10:00:00.000Z");
    expect(creditsExpireAt(paidAt, 6).toISOString()).toBe("2027-03-27T10:00:00.000Z");
    expect(creditsExpireAt(paidAt, 1).toISOString()).toBe("2026-10-27T10:00:00.000Z");
  });

  it("起算点是传进来的那一刻，不是「现在」：付款早晚决定到期早晚", () => {
    const early = creditsExpireAt(new Date("2026-09-27T10:00:00.000Z"), 12);
    const late = creditsExpireAt(new Date("2026-09-27T11:00:00.000Z"), 12);
    expect(late.getTime() - early.getTime()).toBe(60 * 60 * 1000);
  });
});
