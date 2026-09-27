import { describe, expect, it } from "vitest";

import { creditsExpireAt } from "./credits-validity.js";

// 到账积分的有效期口径（PRD §9.5）：自**支付成功时刻**起算，按配置的月数加。
// 这条口径由发放路径（`RechargeService.fulfill`）在钱到账那一刻调用一次，
// 算出来的值同时发给 billing（expiresAt）与写进订单快照（credits_expire_at）。

describe("creditsExpireAt — 订单快照里的有效期", () => {
  it("按支付成功时间起算，加配置的月数（PRD §9.5）", () => {
    const paidAt = new Date("2026-09-27T10:00:00.000Z");
    const expire = creditsExpireAt(paidAt, 24);
    expect(expire.getUTCFullYear()).toBe(2028);
    expect(expire.getUTCMonth()).toBe(8); // 9 月（0 基）
    // 不修改传入的 Date（快照是只读的输入）
    expect(paidAt.toISOString()).toBe("2026-09-27T10:00:00.000Z");
  });

  it("运营配 6 个月就是 6 个月：月数原样生效，不是被写死的 2 年", () => {
    // 这一条守的是「档位/自定义充值配的有效期**真的被读了**」：在此之前整个下单/到账
    // 链路没有任何读方，配 6 个月实际仍按 billing 的 2 年发 —— 配置是个摆设
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
