import { describe, expect, it } from "vitest";

import { parseTier, resolveTier, TIERS, type MembershipPeriod } from "./tier.js";

/** 固定「现在」：解析函数不收时间参数就不能被确定性地测。 */
const NOW = new Date("2026-09-24T12:00:00+08:00");

function period(tier: string, expiresAt: Date | null, status = "active"): MembershipPeriod {
  return { tier, status, expiresAt };
}

const FUTURE = new Date("2026-10-24T12:00:00+08:00");
const PAST = new Date("2026-08-24T12:00:00+08:00");

describe("parseTier", () => {
  it("认得全部合法等级", () => {
    for (const tier of TIERS) expect(parseTier(tier)).toBe(tier);
  });

  it("认不出时返回 null，而不是 free", () => {
    // 返回 free 会把「没有会员」与「值写错了」压成同一个结果，
    // 调用方再也没法判断该不该告警。
    expect(parseTier("PRO")).toBeNull();
    expect(parseTier("vip")).toBeNull();
    expect(parseTier("")).toBeNull();
  });
});

describe("resolveTier", () => {
  it("没有任何周期 = free", () => {
    expect(resolveTier([], NOW)).toEqual({ tier: "free", unknownTiers: [] });
  });

  it("取有效的那个周期", () => {
    expect(resolveTier([period("pro", FUTURE)], NOW).tier).toBe("pro");
  });

  it("已过期的周期不参与", () => {
    expect(resolveTier([period("max", PAST)], NOW).tier).toBe("free");
  });

  it("恰好到期视为已过期（与 SQL 的 expires_at > NOW() 同口径）", () => {
    expect(resolveTier([period("max", new Date(NOW.getTime()))], NOW).tier).toBe("free");
  });

  it("永久周期（expires_at = null）永远有效", () => {
    expect(resolveTier([period("max", null)], NOW).tier).toBe("max");
  });

  it("非 active 状态的周期不参与", () => {
    expect(resolveTier([period("max", FUTURE, "cancelled")], NOW).tier).toBe("free");
    expect(resolveTier([period("max", FUTURE, "expired")], NOW).tier).toBe("free");
  });

  it("多个有效周期取最高等级，不是最晚到期", () => {
    // 用户同时有「明天到期的 max」与「一年后到期的 pro」——他现在就是 max，明天才降。
    // 按最晚到期取会让他今天就被降级，而他明明还持有 max。
    const soonMax = new Date("2026-09-25T12:00:00+08:00");
    const farPro = new Date("2027-09-24T12:00:00+08:00");

    expect(resolveTier([period("max", soonMax), period("pro", farPro)], NOW).tier).toBe("max");
  });

  it("较高的已过期周期不影响较低的有效周期", () => {
    expect(resolveTier([period("max", PAST), period("basic", FUTURE)], NOW).tier).toBe("basic");
  });

  it("认不出的等级被跳过，并原样回报给调用方", () => {
    const resolution = resolveTier([period("vip", FUTURE), period("pro", FUTURE)], NOW);

    // 跳过不等于无视：这个用户此刻的权益取决于那行脏数据，
    // 调用方必须有机会把它记下来。
    expect(resolution.tier).toBe("pro");
    expect(resolution.unknownTiers).toEqual(["vip"]);
  });

  it("认不出的等级去重", () => {
    const resolution = resolveTier(
      [period("vip", FUTURE), period("vip", FUTURE), period("PRO", FUTURE)],
      NOW,
    );
    expect(resolution.tier).toBe("free");
    expect(resolution.unknownTiers).toEqual(["vip", "PRO"]);
  });

  it("只有认不出的周期时按 free 处理，但如实上报", () => {
    const resolution = resolveTier([period("vip", FUTURE)], NOW);
    expect(resolution.tier).toBe("free");
    expect(resolution.unknownTiers).not.toHaveLength(0);
  });

  it("已过期周期里的脏值不上报（它本来就不参与判定）", () => {
    expect(resolveTier([period("vip", PAST)], NOW).unknownTiers).toEqual([]);
  });
});
