/* ============================================
 * 档位单规格构建的**直接**单测。
 *
 * 抽成纯函数之前，下面每一条都只能通过 `RechargeService` 间接测 —— 而要驱动它，
 * 得先备好假 Prisma、假网关与假定价目录。现在这些规则不读任何东西，
 * 测起来就是「调一个函数、看它抛什么」。
 * ============================================ */
import { describe, expect, it } from "vitest";
import { NewApiError } from "@lib/core";
import { makeTierView } from "@lib/shared/topup-tier/topup-tier.testlib.js";
import { buildTierOrderPlan } from "./tier-order-spec.js";

/** 固定一个「下单那一刻」——本函数不读系统时钟，时间由调用方给。 */
const NOW = Date.parse("2026-09-29T12:00:00.000Z");

type TierOverrides = Parameters<typeof makeTierView>[0];

/** 默认一个可买的档位；用例只覆盖自己关心的那几项。 */
function build(overrides: TierOverrides = {}, userId = 1, creditsPerYuan = 15) {
  return buildTierOrderPlan(
    makeTierView({ baseCredits: 7_500, originalPrice: 499, price: 499, ...overrides }),
    creditsPerYuan,
    userId,
    NOW,
  );
}

/** 取抛出物的 message 与 status —— 状态码是 wire 行为的一部分，必须一起钉。 */
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
    // ¥499 × 15 = 7,485，而这一档配的是 7,500。充值常有折扣，拿原价去乘会把用户
    // 实际到手的数算少 —— 这条是本次抽取最该被钉死的语义。
    const plan = build();

    expect(plan.credits).toBe(7_500);
    expect(plan.credits).not.toBe(499 * 15);
    // 换算率只快照（对账与客服追溯用），不参与上面那个数
    expect(plan.creditsPerYuan).toBe(15);
    expect(plan.amountFen).toBe(49_900);
  });

  it("草稿与已下架都拒，但话不同", () => {
    // 「已下架」说的是一个曾经卖过的东西；草稿是**还没上过架**。
    // 对着一张运营刚建好、字段还没配齐的卡片说「已下架」，客服和用户都无从下手。
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
    // 边界：结束时刻**等于**下单时刻仍可买（判据是 `<` 不是 `<=`）
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

    // 403 不是 400：这不是「你填错了」，是「这个账号没有购买资格」（与自定义充值同口径）
    expect(denied.status).toBe(403);
    expect(denied.message).toBe("这个档位只对老客户开放");
  });

  it("白名单：名单里的人放行，名单外的人 403", () => {
    // 判定本身（含数字/字符串归一、前导零）由 `canPurchaseTier` 自己钉。
    // 这条钉的是「档位这条路上确实调了它」—— 放行与拒绝必须**成对**出现：
    // 只断言放行那半的话，一个把判定整个删掉、恒放行的实现也是绿的。
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
    // BigInt 主键超出 JS 安全整数范围时 `Number()` 会**静默改值** ——
    // 那意味着把这一单挂到另一个档位上去。
    expect(reject(() => build({ id: "9007199254740993" }))).toEqual({
      message: "档位 ID 不合法",
      status: 500,
    });
  });

  it("首购参与时快照两列；不参与时只留 eligible=0 且**不写** bonusCredits", () => {
    const joined = build({ firstPurchaseEligible: true, bonusCredits: 3_750 });
    expect(joined.firstPurchaseEligible).toBe(1);
    expect(joined.bonusCredits).toBe(3_750);

    // ⚠️ 不参与却写个非零值，会让对账以为欠用户一笔赠送
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
    // 判为假时上面已经抛了 403，被拒的用户到不了这里 —— 所以这一列只有一种取值。
    // 这条钉的只是**那个字面量本身**（改了就红）；「判定确实发生过」由上面那条
    // 放行/拒绝成对的用例保证。
    expect(build().permissionResult).toBe("allowed");
  });

  it("网关订单的标题与内容取档位名；空名有兜底", () => {
    const named = build({ name: "春季特惠" });
    expect(named.subject).toBe("春季特惠");
    expect(named.body).toBe("春季特惠");

    // 空名兜底：subject/body 是网关侧的必填，空了会把订单变成一条没有名字的记录
    const unnamed = build({ name: "" });
    expect(unnamed.subject).toBe("积分充值");
    expect(unnamed.body).toBe("积分充值 7500 积分");
  });
});
