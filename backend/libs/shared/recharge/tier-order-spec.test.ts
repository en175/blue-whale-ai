import { describe, expect, it } from "vitest";
import { NewApiError } from "@lib/core";
import { makeTierView } from "@lib/shared/topup-tier/topup-tier.testlib.js";
import { buildTierOrderPlan } from "./tier-order-spec.js";

const NOW = Date.parse("2026-09-29T12:00:00.000Z");

type TierOverrides = Parameters<typeof makeTierView>[0];

function build(overrides: TierOverrides = {}, userId = 1, creditsPerYuan = 15) {
  return buildTierOrderPlan(
    makeTierView({ baseCredits: 7_500, originalPrice: 499, price: 499, ...overrides }),
    creditsPerYuan,
    userId,
    NOW,
  );
}

function reject(fn: () => unknown): { message: string; status: number } {
  try {
    fn();
  } catch (e) {
    if (e instanceof NewApiError) return { message: e.message, status: e.status };
    throw e;
  }
  throw new Error("期望抛 NewApiError，但没有抛");
}

describe("buildTierOrderPlan — 档位单的「这一单是什么」", () => {
  it("★ 到账积分取**配置值**，不是「原价 × 换算率」", () => {
    const plan = build();

    expect(plan.credits).toBe(7_500);
    expect(plan.credits).not.toBe(499 * 15);
    expect(plan.creditsPerYuan).toBe(15);
    expect(plan.amountFen).toBe(49_900);
  });

  it("草稿与已下架都拒，但话不同", () => {
    expect(reject(() => build({ status: "draft" }))).toEqual({
      message: "该档位尚未上架",
      status: 400,
    });
    expect(reject(() => build({ status: "inactive" }))).toEqual({
      message: "该档位已下架",
      status: 400,
    });
  });

  it("时间窗未到 / 已过都拒 400，正好到点不算过期", () => {
    const future = new Date(NOW + 86_400_000).toISOString();
    const past = new Date(NOW - 86_400_000).toISOString();

    expect(reject(() => build({ startTime: future }))).toEqual({
      message: "该档位尚未生效",
      status: 400,
    });
    expect(reject(() => build({ endTime: past }))).toEqual({
      message: "该档位已过期",
      status: 400,
    });
    expect(build({ endTime: new Date(NOW).toISOString() }).credits).toBe(7_500);
  });

  it("权限拒绝走 403，并带上运营配的那句提示", () => {
    const denied = reject(() =>
      build(
        {
          permission: "user_group",
          permissionAllowlist: ["9001"],
          permissionDeniedHint: "这个档位只对老客户开放",
        },
        42,
      ),
    );

    expect(denied.status).toBe(403);
    expect(denied.message).toBe("这个档位只对老客户开放");
  });

  it("白名单：名单里的人放行，名单外的人 403", () => {
    const gated = { permission: "user_group" as const, permissionAllowlist: ["9001"] };

    expect(build(gated, 9_001).credits).toBe(7_500);
    expect(reject(() => build(gated, 9_002)).status).toBe(403);
  });

  it("金额或积分为 0 → 500（宁可下不了单，也不要产生这种订单）", () => {
    const expected = { message: "该档位的金额或积分不合法，请联系客服", status: 500 };

    expect(reject(() => build({ baseCredits: 0 }))).toEqual(expected);
    expect(reject(() => build({ price: 0 }))).toEqual(expected);
  });

  it("档位 ID 不是安全整数 → 500", () => {
    expect(reject(() => build({ id: "9007199254740993" }))).toEqual({
      message: "档位 ID 不合法",
      status: 500,
    });
  });

  it("首购参与时快照两列；不参与时只留 eligible=0 且**不写** bonusCredits", () => {
    const joined = build({ firstPurchaseEligible: true, bonusCredits: 3_750 });
    expect(joined.firstPurchaseEligible).toBe(1);
    expect(joined.bonusCredits).toBe(3_750);

    const notJoined = build({ firstPurchaseEligible: false, bonusCredits: 3_750 });
    expect(notJoined.firstPurchaseEligible).toBe(0);
    expect(notJoined.bonusCredits).toBeUndefined();
  });

  it("参与首购但赠送额为 0 时不写 bonusCredits", () => {
    const plan = build({ firstPurchaseEligible: true, bonusCredits: 0 });

    expect(plan.firstPurchaseEligible).toBe(1);
    expect(plan.bonusCredits).toBeUndefined();
  });

  it("商品名对自动生成的旧名重新派生，人工起的名不动", () => {
    expect(build({ name: "5000000积分" }).productName).toBe("7500积分");
    expect(build({ name: "春季特惠" }).productName).toBe("春季特惠");
  });

  it("权限列落的是常量 allowed", () => {
    expect(build().permissionResult).toBe("allowed");
  });

  it("网关订单的标题与内容取档位名；空名有兜底", () => {
    const named = build({ name: "春季特惠" });
    expect(named.subject).toBe("春季特惠");
    expect(named.body).toBe("春季特惠");

    const unnamed = build({ name: "" });
    expect(unnamed.subject).toBe("积分充值");
    expect(unnamed.body).toBe("积分充值 7500 积分");
  });
});
