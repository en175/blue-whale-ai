import { describe, expect, it, vi } from "vitest";

import { NewApiError } from "@lib/core";
import { IS_PUBLIC_KEY } from "@lib/infra/decorators/public.decorator.js";
import { SESSION_COOKIE_NAME } from "@lib/shared/session/cookie.js";
import { RechargeController } from "./recharge.controller.js";


const OFFER = {
  enabled: true,
  minCredits: 600,
  maxCredits: 499_995,
  defaultCredits: 600,
  stepCredits: 15,
  creditsPerYuan: 15,
  creditsValidMonths: 24,
  canPurchase: null as boolean | null,
  deniedHint: "当前账号暂不可购买自定义充值",
};

const CREATED = {
  tradeNo: "RC20260927120000abcd1234",
  cashierUrl: "https://test.hccb.cc/uniCashierNew.html?tokenCode=abc",
  expiresAt: "2026-09-27T12:30:00.000Z",
  amount: 40,
  credits: 600,
};

const CATALOG = {
  creditsPerYuan: 15,
  tiers: [
    {
      id: "7",
      name: "7500积分",
      amount: 7500,
      price: 499,
      originalPrice: 500,
      discount: 1,
      isRecommended: false,
      sortOrder: 1,
      canPurchase: null as boolean | null,
      deniedHint: "当前账号暂不可购买该档位",
      creditsValidMonths: 6,
    },
  ],
};

function makeController(overrides: {
  createOrder?: ReturnType<typeof vi.fn>;
  buildOffer?: ReturnType<typeof vi.fn>;
  listTiers?: ReturnType<typeof vi.fn>;
  resolveSession?: ReturnType<typeof vi.fn>;
} = {}) {
  const createOrder = overrides.createOrder ?? vi.fn().mockResolvedValue(CREATED);
  const buildOffer = overrides.buildOffer ?? vi.fn().mockResolvedValue(OFFER);
  const listTiers = overrides.listTiers ?? vi.fn().mockResolvedValue(CATALOG);
  const resolveSession =
    overrides.resolveSession ?? vi.fn().mockResolvedValue(null);
  const controller = new RechargeController(
    { createOrder, listTiers } as never,
    { buildOffer } as never,
    { resolveSession } as never,
  );
  return { controller, createOrder, buildOffer, listTiers, resolveSession };
}

const reqWith = (cookies: Record<string, string> = {}) => ({ cookies }) as never;
const user = { userId: "9001" } as never;

describe("RechargeController — 路由鉴权姿态", () => {
  it("★ 下单**不是**公开路由：游客点击购买会被 AuthGuard 401 挡在 handler 之外（§7.6「游客购买」）", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, RechargeController.prototype.order)).toBeFalsy();
  });

  it("★ 自定义充值报价**是**公开路由：游客也能看到价格与范围（PRD §7.4「游客可见」）", () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, RechargeController.prototype.customOffer),
    ).toBe(true);
  });

  it("★ 档位目录也是公开路由：价格表本来就是公开信息", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, RechargeController.prototype.tiers)).toBe(
      true,
    );
  });
});

describe("RechargeController.tiers — 档位目录 + 权限信号（PRD §6.3）", () => {
  it("无 cookie = 游客：价格表照给，can_purchase 为 null（未判定）", async () => {
    const { controller, listTiers } = makeController();

    const res = await controller.tiers(reqWith());

    expect(listTiers).toHaveBeenCalledWith(null);
    expect(res.data).toMatchObject({
      credits_per_yuan: 15,
      tiers: [
        {
          id: "7",
          amount: 7500,
          price: 499,
          original_price: 500,
          can_purchase: null,
          denied_hint: "当前账号暂不可购买该档位",
          credits_valid_months: 6,
        },
      ],
    });
  });

  it("★ 有会话 cookie：带上该用户的权限判定（白名单外的用户拿到 false + 提示）", async () => {
    const { controller, listTiers } = makeController({
      listTiers: vi.fn().mockResolvedValue({
        ...CATALOG,
        tiers: [{ ...CATALOG.tiers[0]!, canPurchase: false, deniedHint: "该档位仅限内测用户" }],
      }),
      resolveSession: vi.fn().mockResolvedValue({ userId: 9001n }),
    });

    const res = await controller.tiers(
      reqWith({ [SESSION_COOKIE_NAME]: "tok" }) as never,
    );

    expect(listTiers).toHaveBeenCalledWith(9001);
    expect(res.data).toMatchObject({
      tiers: [{ can_purchase: false, denied_hint: "该档位仅限内测用户" }],
    });
  });

  it("★ 有效期逐档不同：卡片上的那个数必须来自**这一档**，不是页面级的一个写死的年数", async () => {
    const { controller } = makeController({
      listTiers: vi.fn().mockResolvedValue({
        ...CATALOG,
        tiers: [
          { ...CATALOG.tiers[0]!, id: "7", creditsValidMonths: 6 },
          { ...CATALOG.tiers[0]!, id: "8", creditsValidMonths: 24 },
        ],
      }),
    });

    const res = await controller.tiers(reqWith());
    const tiers = (res.data as { tiers: { id: string; credits_valid_months: number }[] })
      .tiers;

    expect(tiers.map((t) => [t.id, t.credits_valid_months])).toEqual([
      ["7", 6],
      ["8", 24],
    ]);
  });

  it("会话解析失败当游客处理，不抛错（cookie 过期不该让充值页多一块红色错误）", async () => {
    const { controller, listTiers } = makeController({
      resolveSession: vi.fn().mockRejectedValue(new Error("session down")),
    });

    const res = await controller.tiers(reqWith({ [SESSION_COOKIE_NAME]: "expired" }));

    expect(listTiers).toHaveBeenCalledWith(null);
    expect((res.data as { tiers: { can_purchase: boolean | null }[] }).tiers[0]?.can_purchase)
      .toBeNull();
  });
});

describe("RechargeController.customOffer — 自定义充值报价", () => {
  it("无 cookie = 游客：展示项齐全、can_purchase 为 null（未判定）", async () => {
    const { controller, buildOffer } = makeController();

    const res = await controller.customOffer(reqWith());

    expect(buildOffer).toHaveBeenCalledWith(null);
    expect(res).toEqual({
      code: 200,
      msg: null,
      data: {
        enabled: true,
        min_credits: 600,
        max_credits: 499_995,
        default_credits: 600,
        step_credits: 15,
        credits_per_yuan: 15,
        credits_valid_months: 24,
        can_purchase: null,
        denied_hint: "当前账号暂不可购买自定义充值",
      },
    });
  });

  it("有会话 cookie：带上该用户的权限判定", async () => {
    const { controller, buildOffer } = makeController({
      buildOffer: vi.fn().mockResolvedValue({ ...OFFER, canPurchase: false }),
      resolveSession: vi.fn().mockResolvedValue({ userId: 9001n }),
    });

    const res = await controller.customOffer(
      reqWith({ [SESSION_COOKIE_NAME]: "tok" }) as never,
    );

    expect(buildOffer).toHaveBeenCalledWith(9001);
    expect((res.data as { can_purchase: boolean | null }).can_purchase).toBe(false);
  });

  it("★ 会话解析失败当游客处理，**不抛错**（cookie 过期不该让充值页多一块红色错误）", async () => {
    const { controller, buildOffer } = makeController({
      resolveSession: vi.fn().mockRejectedValue(new Error("session down")),
    });

    const res = await controller.customOffer(
      reqWith({ [SESSION_COOKIE_NAME]: "expired" }) as never,
    );

    expect(buildOffer).toHaveBeenCalledWith(null);
    expect((res.data as { can_purchase: boolean | null }).can_purchase).toBeNull();
  });
});

describe("RechargeController.order — 两种商品类型走同一个接口", () => {
  it("tier_id → 走档位单（userId 从登录态取，前端传不了）", async () => {
    const { controller, createOrder } = makeController();

    const res = await controller.order({ tier_id: " 7 " }, user);

    expect(createOrder).toHaveBeenCalledWith({ userId: 9001, tierId: "7" });
    expect(res.data).toMatchObject({ trade_no: CREATED.tradeNo, points: 600 });
  });

  it("★ credits → 走自定义充值单（§7.6「登录购买」）", async () => {
    const { controller, createOrder } = makeController();

    await controller.order({ credits: 600 }, user);

    expect(createOrder).toHaveBeenCalledWith({ userId: 9001, credits: 600 });
  });

  it("★ 两个都给 / 都不给 → 400：不做「按某一边解释」的猜测", async () => {
    const { controller, createOrder } = makeController();

    await expect(controller.order({ tier_id: "7", credits: 600 }, user)).rejects.toThrow(
      /只能传一个/,
    );
    await expect(controller.order({}, user)).rejects.toThrow(/缺少 tier_id 或 credits/);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("★ credits 非法（非整数 / 0 / 小数 / 对象）→ 400，且不往下走", async () => {
    const { controller, createOrder } = makeController();

    for (const credits of ["abc", 0, -1, 600.5, {}]) {
      await expect(
        controller.order({ credits }, user),
        `credits=${JSON.stringify(credits)}`,
      ).rejects.toThrow(/credits 须为 1 以上的整数/);
    }
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("credits 传数字串也认（表单从 DOM 出来就是字符串）", async () => {
    const { controller, createOrder } = makeController();

    await controller.order({ credits: "1200" }, user);

    expect(createOrder).toHaveBeenCalledWith({ userId: 9001, credits: 1200 });
  });

  it("★ 业务错误按充值域口径投影（权限 403 带提示文案，不是通用 500）", async () => {
    const { controller } = makeController({
      createOrder: vi
        .fn()
        .mockRejectedValue(new NewApiError("该活动仅限内测用户", 403)),
    });

    await expect(controller.order({ credits: 600 }, user)).rejects.toMatchObject({
      status: 403,
      message: "该活动仅限内测用户",
    });
  });
});
